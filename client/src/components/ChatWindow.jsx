import React, { useState, useEffect, useRef } from 'react';
import { parseEmoji } from '../utils/emoji';
import EmojiPickerButton from './EmojiPickerButton';

const ChatWindow = ({ channelName, messages, onSendMessage, onClose }) => {
    const [inputValue, setInputValue] = useState('');
    const scrollRef = useRef(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!inputValue.trim()) return;
        onSendMessage(inputValue);
        setInputValue('');
    };

    return (
        <div className="chat-window">
            <div className="chat-header">
                <h3># {channelName}</h3>
                <button onClick={onClose}>×</button>
            </div>
            <div className="chat-messages" ref={scrollRef}>
                {messages.map((msg, i) => (
                    <div key={i} className={`message ${msg.isMine ? 'mine' : ''} ${msg.isRoot ? 'root-topic' : 'reply'}`}>
                        {msg.isRoot && <div className="root-indicator">📍 주제 시작</div>}
                        <span className="author">{msg.author}</span>
                        <p>{parseEmoji(msg.text)}</p>
                    </div>
                ))}
            </div>
            <form className="chat-input" onSubmit={handleSubmit} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                    type="text"
                    className="history-chat-input"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="메시지를 입력하세요..."
                    style={{ flex: 1 }}
                />
                <EmojiPickerButton onEmojiSelect={(emoji) => {
                    const input = document.querySelector('.history-chat-input');
                    if (input) {
                        const start = input.selectionStart || inputValue.length;
                        const newValue = inputValue.slice(0, start) + emoji + inputValue.slice(start);
                        setInputValue(newValue);
                        // 포커스 유지를 위해 약간의 지연 후 처리
                        setTimeout(() => {
                            input.focus();
                            input.setSelectionRange(start + emoji.length, start + emoji.length);
                        }, 0);
                    }
                }} />
                <button type="submit">전송</button>
            </form>
        </div>
    );
};

export default ChatWindow;
