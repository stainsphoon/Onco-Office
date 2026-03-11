import { useState, useRef, useEffect } from 'react';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';

/**
 * 이모지 피커 토글 버튼 컴포넌트
 * @param {Function} onEmojiSelect - 이모지 선택 시 호출 (native emoji 문자 전달)
 */
export default function EmojiPickerButton({
    onEmojiSelect,
    returnFullObject = false,
    buttonClassName = "emoji-toggle-btn",
    icon = "😊",
    title = "이모지 추가"
}) {
    const [showPicker, setShowPicker] = useState(false);
    const pickerRef = useRef(null);

    // 외부 클릭 시 피커 닫기
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target)) {
                setShowPicker(false);
            }
        };
        if (showPicker) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showPicker]);

    return (
        <div className="emoji-picker-wrapper" ref={pickerRef}>
            <button
                type="button"
                className={buttonClassName}
                onClick={() => setShowPicker(prev => !prev)}
                title={title}
            >
                {icon}
            </button>
            {showPicker && (
                <div className="emoji-picker-popup">
                    <Picker
                        data={data}
                        onEmojiSelect={(emoji) => {
                            if (returnFullObject) {
                                onEmojiSelect(emoji);
                            } else {
                                onEmojiSelect(emoji.native);
                            }
                            setShowPicker(false);
                        }}
                        theme="light"
                        locale="ko"
                        previewPosition="none"
                        skinTonePosition="none"
                        maxFrequentRows={2}
                        perLine={8}
                    />
                </div>
            )}
        </div>
    );
}
