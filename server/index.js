const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const slackHandler = require('./slackHandler');

app.get('/slack/oauth_redirect', async (req, res) => {
    const { code, state: socketId } = req.query;
    if (!code) return res.status(400).send('No code provided');

    try {
        const result = await slackHandler.exchangeCodeForToken(code);
        if (result.ok && socketId) {
            userTokens[socketId] = result.authed_user.access_token;
            console.log(`Successfully authorized Slack for socket: ${socketId}`);
            // 클라이언트에 토큰 저장 명령
            io.to(socketId).emit('slackTokenAuthorized', result.authed_user.access_token);
        }

        res.send(`
            <html>
                <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                    <h1 style="color: #4A154B;">연동 성공!</h1>
                    <p>슬랙 계정이 가상 오피스와 연결되었습니다.</p>
                    <p>이 창은 잠시 후 자동으로 닫힙니다.</p>
                    <script>setTimeout(() => window.close(), 2000);</script>
                </body>
            </html>
        `);
    } catch (error) {
        console.error('OAuth Redirect Error:', error);
        res.status(500).send('인증에 실패했습니다.');
    }
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // 모든 오리진 허용 (개발 편의성)
        methods: ["GET", "POST"]
    }
});

const players = {};
const zoneSessions = {}; // { zoneName: { rootTs: string, activeUsers: Set } }
const userTokens = {}; // { socketId: slackUserToken }
const globalLastRequests = new Map(); // [중복 방지] { "token:text": timestamp }
const globalProcessedRequests = new Map(); // [중복 방지 4차] { "requestId": timestamp }

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 새 플레이어 생성
    players[socket.id] = {
        x: 800,
        y: 1000,
        id: socket.id,
        avatar: 'default',
        currentZone: 'OncoWorld' // 로비 스폰
    };

    // 본인에게 현재 플레이어들 정보 전송
    socket.emit('currentPlayers', players);

    // 다른 플레이어들에게 새 플레이어 접속 알림
    socket.broadcast.emit('newPlayer', players[socket.id]);

    // 이동 정보 수신 및 전송
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // 구역 진입 알림 수신
    socket.on('joinZone', (zoneName) => {
        if (!players[socket.id]) return;

        const oldZone = players[socket.id].currentZone;

        // [수정] 채널 ID 기반의 룸 관리 로직 강화
        const getChannelId = (name) => {
            if (!name || name === 'OncoWorld') return null;
            return name.split('-thread-')[0]; // C01234-thread-1 -> C01234
        };

        const oldChannelId = getChannelId(oldZone);
        const newChannelId = getChannelId(zoneName);

        // 구체적인 구역(Zone) 룸 관리
        if (oldZone) socket.leave(oldZone);
        socket.join(zoneName);

        // 상위 채널(Channel ID) 기반 룸 관리 (브로드캐스트용)
        // 채널 룸이 바뀌었을 때만 처리하여 불필요한 join/leave 방지
        if (oldChannelId !== newChannelId) {
            if (oldChannelId) {
                socket.leave(oldChannelId);
                console.log(`[Socket ${socket.id}] Left Channel Room: ${oldChannelId}`);
            }
            if (newChannelId) {
                socket.join(newChannelId);
                console.log(`[Socket ${socket.id}] Joined Channel Room: ${newChannelId}`);
            }
        }

        players[socket.id].currentZone = zoneName;

        // 구역 세션 관리 (Slack 연동)
        if (zoneName !== 'OncoWorld') {
            if (!zoneSessions[zoneName]) {
                const sessionTitle = `📍 **Slack Channel Field (${zoneName})**`;
                zoneSessions[zoneName] = { rootTs: null, activeUsers: new Set(), title: sessionTitle };
            }
            zoneSessions[zoneName].activeUsers.add(socket.id);
        }

        if (oldZone && oldZone !== 'OncoWorld' && zoneSessions[oldZone]) {
            zoneSessions[oldZone].activeUsers.delete(socket.id);
            if (zoneSessions[oldZone].activeUsers.size === 0) {
                delete zoneSessions[oldZone];
            }
        }
    });

    socket.on('zoneMessage', async (messageData) => {
        const { text, requestId } = messageData;
        const player = players[socket.id];
        if (!player) return;

        const zoneName = player.currentZone;
        const userToken = userTokens[socket.id];
        const channelId = slackHandler.getChannelForZone(zoneName);
        const now = Date.now();

        // [4차 방어] Request ID 체크
        if (requestId && globalProcessedRequests.has(requestId)) {
            console.log(`[Socket ${socket.id}][DUP_DETECTED] requestId: ${requestId} already processed. Ignoring.`);
            return;
        }
        if (requestId) globalProcessedRequests.set(requestId, now);

        console.log(`[Msg] Socket: ${socket.id}, Req: ${requestId}, Zone: ${zoneName}, Text: "${text.substring(0, 20)}..."`);

        try {
            if (!zoneName.includes('-thread-')) {
                // 채널 필드 또는 로비: 슬랙 채널의 메인 피드(Root)로 전송
                await slackHandler.sendMessageToSlack(channelId, text, null, userToken);
            } else {
                // 스레드 구역 대화: 해당 구역 세션 전용 스레드로 전송
                const zoneSession = zoneSessions[zoneName];
                if (!zoneSession) return;

                if (!zoneSession.rootTs) {
                    const plainText = text.replace(/^📌\s*/, '');
                    const rootMessageText = `📌 ${plainText} - Thread`;
                    const rootResult = await slackHandler.sendMessageToSlack(channelId, rootMessageText, null, userToken);
                    zoneSession.rootTs = rootResult.ts;

                    setTimeout(async () => {
                        const result = await slackHandler.getChannelPosts(channelId, userToken);
                        if (result.ok) {
                            const data = { channelId, posts: result.posts };
                            io.to(channelId).emit('threadPostsData', data);
                        }
                    }, 500);
                } else {
                    await slackHandler.sendMessageToSlack(channelId, text, zoneSession.rootTs, userToken);
                }
            }

            // 구역 내 사용자들에게만 실시간 브로드캐스트
            io.to(zoneName).emit('newZoneMessage', {
                zoneName: zoneName,
                authorId: socket.id,
                author: `User_${socket.id.substring(0, 4)}`,
                text: text,
                timestamp: now
            });
        } catch (error) {
            console.error(`Failed to sync ${zoneName} message:`, error);
        }
    });

    // 저장된 토큰 설정 처리
    socket.on('setSlackToken', (token) => {
        console.log(`[Socket ${socket.id}] Setting persistent Slack token.`);
        userTokens[socket.id] = token;
    });

    // 슬랙 채널 목록 요청 처리
    socket.on('getSlackChannels', async () => {
        const token = userTokens[socket.id];
        console.log(`[Socket ${socket.id}] Requested Slack channels. Token available: ${!!token} (${token ? token.substring(0, 10) + '...' : 'none'})`);
        if (!token) {
            return socket.emit('slackChannels', { error: 'Slack not authorized' });
        }
        try {
            const data = await slackHandler.listChannels(token);
            const count = data.channels ? data.channels.length : 0;
            console.log(`[Socket ${socket.id}] Successfully fetched ${count} channels.`);
            socket.emit('slackChannels', data);
        } catch (error) {
            console.error(`[Socket ${socket.id}] Failed to fetch Slack channels:`, error);
            socket.emit('slackChannels', { error: 'Failed to fetch channels' });
        }
    });

    // [새 기능] 메인 피드(Root) 게시글 전용 생성 처리
    socket.on('createMainPost', async ({ channelId, text, requestId }) => {
        const token = userTokens[socket.id];
        const now = Date.now();

        if (!channelId || !text) return;
        if (!token) return socket.emit('error', { message: '슬랙 인증이 필요합니다.' });

        // [4차 방어] Request ID 체크
        if (requestId && globalProcessedRequests.has(requestId)) {
            console.log(`[Socket ${socket.id}][DUP_DETECTED] createMainPost requestId: ${requestId} already processed.`);
            return;
        }
        if (requestId) globalProcessedRequests.set(requestId, now);

        // [3차 방어] 텍스트 정규화 체크 (3초)
        const normalizedText = text.trim().toLowerCase().replace(/\s+/g, '');
        const dedupKey = `${token}:${normalizedText}`;
        if (globalLastRequests.has(dedupKey) && (now - globalLastRequests.get(dedupKey)) < 3000) {
            console.log(`[Socket ${socket.id}][DUP_DETECTED] Normalized content: ${normalizedText}`);
            return;
        }
        globalLastRequests.set(dedupKey, now);

        console.log(`[MainPost] Socket: ${socket.id}, Req: ${requestId}, Text: "${text.substring(0, 20)}..."`);

        try {
            const plainText = text.replace(/^📌\s*/, '');
            const rootMessageText = `📌 ${plainText}`;
            const rootResult = await slackHandler.sendMessageToSlack(channelId, rootMessageText, null, token);

            setTimeout(async () => {
                const result = await slackHandler.getChannelPosts(channelId, token);
                if (result.ok) {
                    const data = { channelId, posts: result.posts };
                    io.emit('threadPostsData', data);
                }
            }, 800);
        } catch (error) {
            console.error('[MainPost] Error:', error);
        }
    });

    // 스레드 게시글(루트) 목록 요청 처리
    socket.on('getThreadPosts', async (channelId) => {
        const token = userTokens[socket.id];
        if (!channelId) return socket.emit('error', { message: '채널 아이디가 없습니다.' });
        if (!token) return socket.emit('error', { message: '슬랙 인증이 필요합니다.' });

        console.log(`[Socket ${socket.id}] Requested Thread Posts for ${channelId}`);
        const result = await slackHandler.getChannelPosts(channelId, token);
        if (result.ok) {
            socket.emit('threadPostsData', { channelId, posts: result.posts });
        } else {
            console.error(`[Socket ${socket.id}] Failed to fetch thread posts:`, result.error);
            socket.emit('error', { message: '게시글 목록을 불러오지 못했습니다.' });
        }
    });

    // 특정 게시글의 코멘트(답글) 목록 요청 처리
    socket.on('getThreadReplies', async ({ channelId, threadTs }) => {
        const token = userTokens[socket.id];
        if (!channelId || !threadTs) return socket.emit('error', { message: '채널 또는 스레드 정보가 없습니다.' });
        if (!token) return socket.emit('error', { message: '슬랙 인증이 필요합니다.' });

        console.log(`[Socket ${socket.id}] Requested Thread Replies for ${threadTs}`);
        const result = await slackHandler.getThreadReplies(channelId, threadTs, token);
        if (result.ok) {
            socket.emit('threadRepliesData', { threadTs, replies: result.replies });
        } else {
            console.error(`[Socket ${socket.id}] Failed to fetch thread replies:`, result.error);
            socket.emit('error', { message: '코멘트 목록을 불러오지 못했습니다.' });
        }
    });

    // 특정 스레드에 코멘트(답글) 작성 요청 처리
    socket.on('createThreadReply', async ({ channelId, threadTs, text, requestId }) => {
        const token = userTokens[socket.id];
        const now = Date.now();

        if (!channelId || !threadTs || !text) return;
        if (!token) return socket.emit('error', { message: '슬랙 인증이 필요합니다.' });

        // [4차 방어] Request ID 체크
        if (requestId && globalProcessedRequests.has(requestId)) {
            console.log(`[Socket ${socket.id}][DUP_DETECTED] createThreadReply requestId: ${requestId} already processed.`);
            return;
        }
        if (requestId) globalProcessedRequests.set(requestId, now);

        // [3차 방어] 정규화 체크 (3초)
        const normalizedText = text.trim().toLowerCase().replace(/\s+/g, '');
        const dedupKey = `${token}:${normalizedText}`;
        if (globalLastRequests.has(dedupKey) && (now - globalLastRequests.get(dedupKey)) < 3000) {
            console.log(`[Socket ${socket.id}][DUP_DETECTED] Normalized content: ${normalizedText}`);
            return;
        }
        globalLastRequests.set(dedupKey, now);

        console.log(`[Reply] Socket: ${socket.id}, Req: ${requestId}, Thread: ${threadTs}`);

        try {
            console.log(`[Reply] Sending to Slack... Channel: ${channelId}, Thread: ${threadTs}`);
            const result = await slackHandler.sendMessageToSlack(channelId, text, threadTs, token);
            console.log(`[Reply] Slack API result.ok: ${result.ok}, ts: ${result.ts || 'N/A'}`);

            if (result.ok) {
                // 코멘트 목록 갱신
                const repliesResult = await slackHandler.getThreadReplies(channelId, threadTs, token);
                console.log(`[Reply] Fetched ${repliesResult.replies?.length || 0} replies`);

                if (repliesResult.ok) {
                    const data = { threadTs, replies: repliesResult.replies };
                    // 룸 기반 브로드캐스트
                    io.to(channelId).emit('threadRepliesData', data);
                    // 본인에게 직접 전달 (소켓 룸 미참여 시 폴백)
                    socket.emit('threadRepliesData', data);
                    console.log(`[Reply] Broadcasted to room ${channelId} + sender`);
                }
            } else {
                console.error(`[Reply] Slack API FAILED:`, result.error || result);
            }
        } catch (error) {
            console.error(`[Reply] Error:`, error.message || error);
        }
    });

    // 특정 메시지에 이모지 반응 추가 요청 처리
    socket.on('addReaction', async ({ channelId, threadTs, emoji }) => {
        const token = userTokens[socket.id];
        if (!channelId || !threadTs || !emoji) return;
        if (!token) return socket.emit('error', { message: '슬랙 인증이 필요합니다.' });

        const actualChannelId = slackHandler.getChannelForZone(channelId);
        console.log(`[Reaction] Socket: ${socket.id}, Zone: ${channelId}, ActualChannel: ${actualChannelId}, TS: ${threadTs}, Emoji: ${emoji}`);

        try {
            const result = await slackHandler.addReaction(actualChannelId, threadTs, emoji, token);
            if (result.ok) {
                // 이모지 반응이 추가된 후 최신 반응 목록을 브로드캐스트
                const reactionsResult = await slackHandler.getReactions(actualChannelId, threadTs, token);
                if (reactionsResult.ok) {
                    // 클라이언트에서 원래 룸(channelId 즉 Zone ID)으로 보내야
                    // channelId로 가입한 클라이언트가 이벤트를 받음
                    io.to(channelId).emit('updateMessageReactions', {
                        threadTs,
                        reactions: reactionsResult.reactions
                    });
                }
            } else {
                console.error(`[Reaction] Slack API FAILED:`, result.error);
            }
        } catch (error) {
            console.error(`[Reaction] Error:`, error.message || error);
        }
    });

    // 만료된 캐시 데이터 주기적 정리 (connection 단위로 체크)
    const cleanupNow = Date.now();
    if (globalProcessedRequests.size > 200) {
        for (const [key, time] of globalProcessedRequests) {
            if (cleanupNow - time > 10000) globalProcessedRequests.delete(key);
        }
        for (const [key, time] of globalLastRequests) {
            if (cleanupNow - time > 10000) globalLastRequests.delete(key);
        }
    }

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        if (players[socket.id]) {
            const lastZone = players[socket.id].currentZone;
            if (lastZone && lastZone !== '로비' && zoneSessions[lastZone]) {
                zoneSessions[lastZone].activeUsers.delete(socket.id);
                if (zoneSessions[lastZone].activeUsers.size === 0) {
                    delete zoneSessions[lastZone];
                }
            }
            delete players[socket.id];
        }
        io.emit('disconnectPlayer', socket.id);
        delete userTokens[socket.id];
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);

    try {
        const result = await slackHandler.listChannels();
        const channels = result.channels || [];
        if (channels.length > 0) {
            console.log('--- Available Slack Channels ---');
            channels.forEach(ch => console.log(`[${ch.name}] ID: ${ch.id}`));
            console.log('--------------------------------');
        } else {
            console.log('No Slack channels found or token invalid.');
        }
    } catch (err) {
        console.warn('Initial Slack channel sync neglected due to permissions:', err.message);
    }
});
