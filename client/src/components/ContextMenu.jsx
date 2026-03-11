import React from 'react';

const ContextMenu = ({ x, y, targetUser, onAction, onClose }) => {
    return (
        <div
            className="context-menu"
            style={{
                position: 'absolute',
                left: x,
                top: y,
                zIndex: 100
            }}
            onMouseLeave={onClose}
        >
            <div className="menu-header">{targetUser}</div>
            <button onClick={() => onAction('slack_dm')}>Slack DM 보내기</button>
            <button onClick={() => onAction('view_profile')}>프로필 보기</button>
            <button onClick={onClose}>닫기</button>
        </div>
    );
};

export default ContextMenu;
