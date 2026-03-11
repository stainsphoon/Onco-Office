import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import MainScene from '../game/MainScene';

const GameContainer = ({ avatarData }) => {
    const gameRef = useRef(null);

    useEffect(() => {
        if (!gameRef.current) {
            const config = {
                type: Phaser.AUTO,
                width: '100%',
                height: '100%',
                parent: 'game-container',
                scale: {
                    mode: Phaser.Scale.RESIZE,
                    autoCenter: Phaser.Scale.CENTER_BOTH
                },
                physics: {
                    default: 'arcade',
                    arcade: {
                        gravity: { y: 0 },
                        debug: false
                    }
                },
                scene: MainScene
            };
            gameRef.current = new Phaser.Game(config);
        }

        // avatarData가 변경될 때마다 씬에 알림
        if (gameRef.current && avatarData) {
            const scene = gameRef.current.scene.getScene('MainScene');
            if (scene && scene.sys.isActive()) {
                scene.events.emit('update-avatar', avatarData);
            } else {
                gameRef.current.registry.set('avatarData', avatarData);
            }
        }
    }, [avatarData]);

    return (
        <div id="game-container" style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />
    );
};

export default GameContainer;
