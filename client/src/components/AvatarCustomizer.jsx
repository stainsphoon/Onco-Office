import React, { useState } from 'react';

const AvatarCustomizer = ({ onSave }) => {
    const [hair, setHair] = useState('#ff0000');
    const [top, setTop] = useState('#00ff00');
    const [bottom, setBottom] = useState('#0000ff');

    return (
        <div className="customizer-overlay">
            <div className="customizer-card">
                <h3>아바타 커스터마이징</h3>
                <div className="input-group">
                    <label>헤어 색상</label>
                    <input type="color" value={hair} onChange={(e) => setHair(e.target.value)} />
                </div>
                <div className="input-group">
                    <label>상의 색상</label>
                    <input type="color" value={top} onChange={(e) => setTop(e.target.value)} />
                </div>
                <div className="input-group">
                    <label>하의 색상</label>
                    <input type="color" value={bottom} onChange={(e) => setBottom(e.target.value)} />
                </div>
                <button
                    className="save-btn"
                    onClick={() => onSave({ hair, top, bottom })}
                >
                    접속하기
                </button>
            </div>
        </div>
    );
};

export default AvatarCustomizer;
