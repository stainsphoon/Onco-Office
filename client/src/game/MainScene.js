import Phaser from 'phaser';
import { io } from 'socket.io-client';

export default class MainScene extends Phaser.Scene {
    constructor() {
        super('MainScene');
        this.player = null;
        this.cursors = null;
        this.otherPlayers = {};
        this.socket = null;
    }

    preload() {
        // 임시 이미지
        this.load.image('ground', 'https://labs.phaser.io/assets/skies/space2.png');
    }

    create() {
        // [중복 방지] 전역 소켓 인스턴스가 있으면 재사용하고, 없으면 새로 생성합니다.
        if (!window.phaserSocket) {
            window.phaserSocket = io();
            console.log(`[Phaser] New socket created: ${window.phaserSocket.id}`);
        }
        this.socket = window.phaserSocket;

        // 리스너를 즉시 등록하여 놓치는 메시지가 없도록 함
        // 중복 등록 방지를 위해 기존 리스너 모두 제거 후 등록
        this.socket.off('connect');
        this.socket.on('connect', () => {
            console.log(`[Phaser] Connected! Socket ID: ${this.socket.id}`);
        });

        this.socket.off('currentPlayers');
        this.socket.on('currentPlayers', (players) => {
            console.log('[Phaser] Received currentPlayers list:', Object.keys(players));
            const checkAndAddPlayers = () => {
                if (!this.socket.id) {
                    setTimeout(checkAndAddPlayers, 50);
                    return;
                }
                const myId = this.socket.id;
                Object.keys(players).forEach((id) => {
                    if (id === myId) {
                        if (!this.player) this.addPlayer(players[id]);
                    } else {
                        if (!this.otherPlayers[id]) this.addOtherPlayers(players[id]);
                    }
                });
            };
            checkAndAddPlayers();
        });

        this.socket.off('newPlayer');
        this.socket.on('newPlayer', (playerInfo) => {
            console.log('[Phaser] New player joined:', playerInfo.id);
            if (playerInfo.id !== this.socket.id && !this.otherPlayers[playerInfo.id]) {
                this.addOtherPlayers(playerInfo);
            }
        });

        // React에 소켓 준비 알림 (이미 소켓이 있는 경우 중복 발송 방지를 위해 한 번만 실행되도록 조절 가능하지만, 
        // App.jsx에서 setSocket이 동일 객체면 렌더링에 큰 지장 없으므로 유지)
        window.dispatchEvent(new CustomEvent('socket-ready', { detail: this.socket }));

        // 배경 및 구역 설정
        this.add.rectangle(800, 600, 1600, 1200, 0xdcedc8).setDepth(-10);
        this.add.grid(800, 600, 1600, 1200, 32, 32, 0xffffff, 0, 0x000000, 0.05).setDepth(-9);

        this.zones = this.physics.add.staticGroup();
        this.slackDynamicZones = this.physics.add.staticGroup();

        const jiraZone = this.add.rectangle(600, 200, 250, 200, 0xff9800, 0.2).setStrokeStyle(2, 0xff9800);
        this.add.text(600, 120, 'Jira Board', { fontSize: '16px', fill: '#ff9800', fontWeight: 'bold' }).setOrigin(0.5);
        this.zones.add(jiraZone);
        jiraZone.name = 'Jira Board';

        this.socket.off('disconnectPlayer');
        this.socket.on('disconnectPlayer', (playerId) => {
            if (this.otherPlayers[playerId]) {
                this.otherPlayers[playerId].destroy();
                this.otherPlayers[playerId].label.destroy();
                delete this.otherPlayers[playerId];
            }
        });

        this.socket.off('playerMoved');
        this.socket.on('playerMoved', (playerInfo) => {
            if (this.otherPlayers[playerInfo.id]) {
                this.otherPlayers[playerInfo.id].x = playerInfo.x;
                this.otherPlayers[playerInfo.id].y = playerInfo.y;
                this.otherPlayers[playerInfo.id].label.x = playerInfo.x;
                this.otherPlayers[playerInfo.id].label.y = playerInfo.y - 30;
            }
        });

        this.socket.off('newZoneMessage');
        this.socket.on('newZoneMessage', (msg) => {
            let target = null;
            if (msg.authorId === this.socket.id) {
                target = this.player;
            } else if (this.otherPlayers[msg.authorId]) {
                target = this.otherPlayers[msg.authorId];
            }

            if (target) {
                this.showSpeechBubble(target, msg.text);
            }
        });

        this.cameras.main.setBounds(0, 0, 1600, 1200);
        this.cursors = this.input.keyboard.createCursorKeys();

        // [중요] Phaser가 키보드 이벤트를 독점하지 않도록 설정 (HTML Input에서의 띄어쓰기 등 해결)
        // 특히 Space(32) 키의 브라우저 캡처를 해제합니다.
        this.input.keyboard.removeCapture(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.input.keyboard.removeCapture(Phaser.Input.Keyboard.KeyCodes.ENTER);

        // Phaser가 활성화되지 않았을 때(Input 포커스 등) 키보드 입력을 무시하도록 함
        this.input.keyboard.on('keydown', (event) => {
            const activeElement = document.activeElement;
            if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable)) {
                event.stopPropagation();
            }
        });

        this.zoneLabel = this.add.text(20, 20, '위치: OncoWorld', {
            fontSize: '18px', fill: '#333', backgroundColor: '#fff', padding: { x: 10, y: 5 }
        }).setScrollFactor(0).setDepth(100);

        // 우클릭 이벤트 리스너 (아바타 상호작용 대비)
        this.input.on('pointerdown', (pointer) => {
            if (pointer.rightButtonDown()) {
                this.handleRightClick(pointer);
            }
        });

        // 텔레포트 이벤트 리스너
        window.addEventListener('teleport-to-zone', (e) => {
            if (!this.player) return; // 플레이어 없으면 무시
            const { name } = e.detail;
            console.log(`[Phaser] Teleporting to ID: ${name}`);

            // 1. 고정 존 또는 동적 존에서 찾기
            const allZones = [...this.zones.getChildren(), ...this.slackDynamicZones.getChildren()];
            const exactZone = allZones.find(z => z.name === name);

            if (exactZone) {
                // 페이드 아웃 연출
                this.cameras.main.fadeOut(300, 0, 0, 0);
                this.cameras.main.once('camerafadeoutcomplete', () => {
                    this.player.x = exactZone.x;
                    this.player.y = exactZone.y;
                    this.cameras.main.fadeIn(300, 0, 0, 0);
                    // 즉시 패닝하여 오차 보정
                    this.cameras.main.pan(exactZone.x, exactZone.y, 0);
                });
            } else if (name === 'OncoWorld' || name === '로비') {
                this.cameras.main.fadeOut(300, 0, 0, 0);
                this.cameras.main.once('camerafadeoutcomplete', () => {
                    this.player.x = 800;
                    this.player.y = 1000;
                    this.cameras.main.fadeIn(300, 0, 0, 0);
                    this.cameras.main.pan(800, 1000, 0);
                });
            }
        });

        // 슬랙 채널 동기화 리스너
        window.addEventListener('sync-slack-channels', (e) => {
            this.setupDynamicSlackZones(e.detail);
        });

        // 아바타 데이터 업데이트 리스너 (React -> GameContainer -> Phaser)
        this.events.on('update-avatar', (data) => {
            console.log('[Phaser] Avatar data event received', data);
            this.initialAvatarData = data; // 추후 생성될 플레이어를 위해 저장
            if (this.player) {
                this.updatePlayerAvatar(this.player, data);
            }
        });

        // 초기 레지스트리 데이터 확인
        const initialAvatar = this.registry.get('avatarData');
        if (initialAvatar) {
            console.log('[Phaser] Initial avatar data found in registry');
            this.initialAvatarData = initialAvatar;
        }
    }

    updatePlayerAvatar(player, data) {
        if (!player || !data) return;
        // 단순 사각형 대신 파츠별 색상 적용 (추후 그래픽 개선 가능)
        // 여기서는 가장 메인인 hair 색상을 우선 적용
        const color = parseInt(data.top.replace('#', '0x'), 16) || 0x4facfe;
        player.setFillStyle(color);
        player.setStrokeStyle(2, 0x000000); // 가시성을 위해 검은 테두리 추가
    }

    setupDynamicSlackZones(data) {
        // 기존 동적 존 제거
        this.slackDynamicZones.clear(true, true);
        if (this.slackLabels) {
            this.slackLabels.forEach(l => l.destroy());
        }
        if (this.slackIslandGrounds) {
            this.slackIslandGrounds.forEach(g => g.destroy());
        }
        this.slackLabels = [];
        this.slackIslandGrounds = [];

        const channels = data.channels || [];
        const startX = 5000; // 로비에서 아주 멀리 떨어뜨림
        const startY = 5000;
        const spacingX = 5000; // 섬 간의 간격을 광활하게 설정
        const spacingY = 5000;
        const cols = 5;

        // 고유 색상 팔레트 (섬마다 다른 분위기)
        const colors = [0xd1f2eb, 0xfdebd0, 0xd6eaf8, 0xe8daef, 0xfadbd8, 0xd5dbdb];

        channels
            .filter(ch => !ch.is_im)
            .forEach((ch, index) => {
                const col = index % cols;
                const row = Math.floor(index / cols);
                const x = startX + col * spacingX;
                const y = startY + row * spacingY;

                const color = colors[index % colors.length];
                const displayName = ch.is_private ? ch.display_name : ch.name;

                // 1. 섬 대지 (Island Ground) - "아예 다른 필드" 느낌을 주기 위한 거대 배경
                const ground = this.add.rectangle(x, y, 3000, 2000, color, 1).setDepth(-1);
                this.add.grid(x, y, 3000, 2000, 64, 64, 0xffffff, 0, 0x000000, 0.1).setDepth(-1);
                this.slackIslandGrounds.push(ground);

                // 2. 실제 활동 구역 (Zone) - 이제 'Channel Field' 전체
                const zone = this.add.rectangle(x, y, 3000, 2000, 0x4facfe, 0).setStrokeStyle(4, 0x4facfe, 0.2);
                zone.name = ch.id;
                zone.displayName = displayName;
                zone.isMainChannel = true; // 메인 채널 판별용
                this.slackDynamicZones.add(zone);

                // 3. 서브 스레드 필드 (Thread Fields) - 3개 배치
                const threadOffsets = [
                    { dx: -800, dy: 500, label: 'Thread Field 1' },
                    { dx: 0, dy: 800, label: 'Thread Field 2' },
                    { dx: 800, dy: 500, label: 'Thread Field 3' }
                ];

                threadOffsets.forEach((off, i) => {
                    const tx = x + off.dx;
                    const ty = y + off.dy;

                    // 스레드 구역 박스
                    const tZone = this.add.rectangle(tx, ty, 400, 300, 0xffffff, 0.2).setStrokeStyle(2, 0x4facfe, 0.8);
                    tZone.name = `${ch.id}-thread-${i + 1}`;
                    tZone.displayName = `${displayName} (${off.label})`;
                    this.slackDynamicZones.add(tZone);

                    // 스레드 구역 라벨
                    const tLabel = this.add.text(tx, ty - 180, off.label, {
                        fontSize: '24px',
                        fill: '#4facfe',
                        fontWeight: 'bold',
                        backgroundColor: 'rgba(255,255,255,0.8)',
                        padding: { x: 10, y: 5 }
                    }).setOrigin(0.5);
                    this.slackLabels.push(tLabel);
                });

                // 4. 중앙 랜드마크 텍스트
                const titleText = this.add.text(x, y - 400, `Welcome to`, {
                    fontSize: '32px', fill: '#4facfe', fontWeight: 'bold'
                }).setOrigin(0.5);
                const label = this.add.text(x, y - 350, `#${displayName}`, {
                    fontSize: '64px',
                    fill: '#4facfe',
                    fontWeight: '900',
                    backgroundColor: 'rgba(255,255,255,0.7)',
                    padding: { x: 20, y: 10 }
                }).setOrigin(0.5);

                this.slackLabels.push(titleText, label);
            });

        // 카메라 범위 및 물리 세계 범위 대폭 확장
        const totalRows = Math.ceil(channels.length / cols);
        const maxW = startX + cols * spacingX + 5000;
        const maxH = startY + totalRows * spacingY + 5000;
        this.cameras.main.setBounds(0, 0, maxW, maxH);
        this.physics.world.setBounds(0, 0, maxW, maxH);
    }

    addPlayer(playerInfo) {
        console.log(`[Phaser] Adding local player at ${playerInfo.x}, ${playerInfo.y}`);
        this.player = this.add.rectangle(playerInfo.x, playerInfo.y, 32, 48, 0x4facfe);
        this.physics.add.existing(this.player);
        this.player.body.setCollideWorldBounds(true);

        // 초기 아바타 색상 적용
        if (this.initialAvatarData) {
            this.updatePlayerAvatar(this.player, this.initialAvatarData);
        } else {
            this.player.setStrokeStyle(2, 0x000000); // 기본 테두리
        }

        this.player.label = this.add.text(playerInfo.x, playerInfo.y - 40, '나', {
            fontSize: '16px',
            fill: '#000',
            backgroundColor: 'rgba(255,255,255,0.8)',
            padding: { x: 6, y: 3 },
            fontWeight: 'bold'
        }).setOrigin(0.5).setDepth(101);

        this.player.setDepth(100);
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        this.cameras.main.setZoom(1.15); // 줌 소폭 하향 조정 (사용자 피드백 반영: 1.3 -> 1.15)
        // 물리적 오버랩 대신 update 루프의 면적 기반 인식을 사용하므로 제거 또는 주석 처리
        /*
        this.physics.add.overlap(this.player, this.zones, (p, zone) => {
            this.handleZoneEntry(zone);
        });

        this.physics.add.overlap(this.player, this.slackDynamicZones, (p, zone) => {
            this.handleZoneEntry(zone);
        });
        */
    }

    handleZoneEntry(zone) {
        if (this.currentZoneName !== zone.name) {
            const oldZoneName = this.currentZoneName;
            this.currentZoneName = zone.name;

            const isSlack = zone.displayName !== undefined;
            const isThread = zone.name.includes('-thread-');
            const channelId = isSlack ? (isThread ? zone.name.split('-thread-')[0] : zone.name) : 'basic';

            // 명칭 최적화
            let displayName = isSlack ? `#${zone.displayName}` : zone.name;
            if (isThread) {
                const match = zone.displayName.match(/^(.*) \(Thread Field \d+\)$/);
                const channelDisplayName = match ? match[1] : zone.displayName;
                displayName = `${channelDisplayName} (${zone.displayName.split('(')[1]}`;
            }

            const type = isThread ? 'thread' : (isSlack ? 'slack' : 'neutral');
            const parentSection = isSlack ? 'slack' : 'home'; // 계층 구조 정의

            // 필드 이동 시 알림 여부 판단 (채널이 바뀌었을 때만)
            const isNewChannel = (channelId !== this.lastChannelId);

            this.zoneLabel.setText(`위치: ${displayName}`);

            // 서버에 조인 통보
            this.socket.emit('joinZone', zone.name);

            // React에 공지
            window.dispatchEvent(new CustomEvent('phaser-zone-notify', {
                detail: {
                    name: displayName,
                    type: type,
                    parentSection: parentSection, // 신규 추가
                    isNewChannel: isNewChannel,
                    zoneId: channelId
                }
            }));

            this.lastChannelId = channelId;
        }
    }

    addOtherPlayers(playerInfo) {
        const otherPlayer = this.add.rectangle(playerInfo.x, playerInfo.y, 32, 48, 0xf44336);
        otherPlayer.id = playerInfo.id;
        otherPlayer.label = this.add.text(playerInfo.x, playerInfo.y - 30, `User_${playerInfo.id.substring(0, 4)}`, {
            fontSize: '12px',
            fill: '#666'
        }).setOrigin(0.5);
        this.otherPlayers[playerInfo.id] = otherPlayer;

        // 클릭 가능하게 설정
        otherPlayer.setInteractive();
    }

    handleRightClick(pointer) {
        // 클릭된 좌표 근처의 다른 플레이어 찾기
        const clickedOtherServer = Object.values(this.otherPlayers).find(other => {
            return Phaser.Geom.Intersects.RectangleToRectangle(
                new Phaser.Geom.Rectangle(pointer.worldX - 5, pointer.worldY - 5, 10, 10),
                other.getBounds()
            );
        });

        if (clickedOtherServer) {
            // 커스텀 이벤트를 발생시켜 React에 알림
            const event = new CustomEvent('phaser-context-menu', {
                detail: {
                    x: pointer.x,
                    y: pointer.y,
                    user: `User_${clickedOtherServer.id.substring(0, 4)}`
                }
            });
            window.dispatchEvent(event);
        }
    }

    showSpeechBubble(target, text) {
        if (target.speechBubble) target.speechBubble.destroy();

        const bubblePadding = 12;
        const style = {
            fontSize: '14px',
            fontFamily: 'Outfit, sans-serif',
            fill: '#1a1a1a',
            align: 'center',
            wordWrap: { width: 180 }
        };

        const content = this.add.text(0, 0, text, style).setOrigin(0.5);
        const bubbleWidth = Math.max(40, content.width + bubblePadding * 2);
        const bubbleHeight = content.height + bubblePadding * 2;

        const bubble = this.add.container(target.x, target.y - 75);

        const graphics = this.add.graphics();

        // 그림자 효과 (약간의 오프셋)
        graphics.fillStyle(0x000000, 0.1);
        graphics.fillRoundedRect(-bubbleWidth / 2 + 3, -bubbleHeight / 2 + 3, bubbleWidth, bubbleHeight, 12);

        // 말풍선 배경
        graphics.fillStyle(0xffffff, 1);
        graphics.lineStyle(1.5, 0xe2e8f0, 1);
        graphics.fillRoundedRect(-bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth, bubbleHeight, 12);
        graphics.strokeRoundedRect(-bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth, bubbleHeight, 12);

        // 말풍선 꼬리 (삼각형)
        const tailWidth = 10;
        const tailHeight = 8;
        graphics.beginPath();
        graphics.moveTo(-tailWidth / 2, bubbleHeight / 2);
        graphics.lineTo(tailWidth / 2, bubbleHeight / 2);
        graphics.lineTo(0, bubbleHeight / 2 + tailHeight);
        graphics.closePath();
        graphics.fillPath();
        graphics.strokePath();

        bubble.add([graphics, content]);
        bubble.setDepth(2000);
        bubble.setScale(0); // 애니메이션 시작 크기

        // 나타나기 애니메이션
        this.tweens.add({
            targets: bubble,
            scaleX: 1,
            scaleY: 1,
            duration: 250,
            ease: 'Back.easeOut'
        });

        target.speechBubble = bubble;

        this.time.delayedCall(4000, () => {
            if (bubble && bubble.active) {
                this.tweens.add({
                    targets: bubble,
                    alpha: 0,
                    y: bubble.y - 10,
                    duration: 400,
                    onComplete: () => {
                        if (target.speechBubble === bubble) target.speechBubble = null;
                        bubble.destroy();
                    }
                });
            }
        });
    }

    update() {
        if (!this.player) return;

        // 말풍선 위치 실시간 동기화
        if (this.player.speechBubble) {
            this.player.speechBubble.x = this.player.x;
            this.player.speechBubble.y = this.player.y - 70;
        }
        Object.values(this.otherPlayers).forEach(other => {
            if (other.speechBubble) {
                other.speechBubble.x = other.x;
                other.speechBubble.y = other.y - 70;
            }
        });

        const speed = 250;
        const prevX = this.player.x;
        const prevY = this.player.y;

        this.player.body.setVelocity(0);

        if (this.cursors.left.isDown) {
            this.player.body.setVelocityX(-speed);
        } else if (this.cursors.right.isDown) {
            this.player.body.setVelocityX(speed);
        }

        if (this.cursors.up.isDown) {
            this.player.body.setVelocityY(-speed);
        } else if (this.cursors.down.isDown) {
            this.player.body.setVelocityY(speed);
        }

        // 라벨 위치 업데이트
        this.player.label.x = this.player.x;
        this.player.label.y = this.player.y - 30;

        // 구역 인식 (계층 구조 반영)
        const allPossibleZones = [...this.zones.getChildren(), ...this.slackDynamicZones.getChildren()];
        const overlappingZones = allPossibleZones.filter(z =>
            Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), z.getBounds())
        );

        if (overlappingZones.length > 0) {
            // 가장 면적이 작은 존(더 구체적인 존)을 선택
            const bestZone = overlappingZones.reduce((prev, curr) => {
                const prevArea = prev.width * prev.height;
                const currArea = curr.width * curr.height;
                return currArea < prevArea ? curr : prev;
            });
            this.handleZoneEntry(bestZone);
        } else {
            if (this.currentZoneName !== 'OncoWorld') {
                this.currentZoneName = 'OncoWorld';
                this.zoneLabel.setText('위치: OncoWorld');
                this.socket.emit('joinZone', 'OncoWorld');

                const isNewChannel = (this.lastChannelId !== 'basic');
                window.dispatchEvent(new CustomEvent('phaser-zone-notify', {
                    detail: {
                        name: 'OncoWorld',
                        type: 'basic',
                        parentSection: 'home',
                        isNewChannel: isNewChannel,
                        zoneId: 'basic'
                    }
                }));
                this.lastChannelId = 'basic';
            }
        }

        // 이동 시 서버로 위치 전송
        if (this.player.x !== prevX || this.player.y !== prevY) {
            this.socket.emit('playerMovement', { x: this.player.x, y: this.player.y });
        }

        // 거리 기반 텍스트 가시성 조절 (Proximity Chat 기초)
        Object.values(this.otherPlayers).forEach(other => {
            const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, other.x, other.y);
            other.label.setVisible(distance < 500);
            if (other.speechBubble) other.speechBubble.setVisible(distance < 500);
            if (distance < 200) {
                other.alpha = 1;
                other.label.alpha = 1;
            } else {
                other.alpha = 0.5;
                other.label.alpha = 0.5;
            }
        });
    }

    resize(gameSize) {
        const { width, height } = gameSize;
        this.cameras.main.setViewport(0, 0, width, height);
    }
}
