import React from 'react';

const FieldOverlay = ({ zoneInfo, onAction }) => {
    if (!zoneInfo || zoneInfo.type !== 'slack') return null;

    const { name, url } = zoneInfo;

    return (
        <div className="field-overlay">
            <div className="overlay-content">
                <div className="overlay-header">
                    <span className="type-badge">💬 Slack Channel</span>
                    <h4>{name}</h4>
                </div>
                <p>이 구역에서 입력하는 메시지는 슬랙 채널 메인 피드로 전송됩니다.</p>
                <div className="overlay-footer">
                    <button className="chat-btn" onClick={() => onAction('chat')}>참여 기록 보기</button>
                    {url && (
                        <button className="open-btn" onClick={() => window.open(url, '_blank')}>
                            웹에서 열기
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FieldOverlay;
