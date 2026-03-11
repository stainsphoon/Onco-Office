/**
 * 텍스트 내의 Slack 스타일 이모지 명령어(:smile:)를 유니코드 이모지(😊)로 변환합니다.
 * node-emoji가 브라우저 환경에서 하얀 화면을 유발하여 직접 매핑 방식을 사용합니다.
 */

// 가장 자주 쓰이는 슬랙 이모지 매핑 (필요시 추가 가능)
const emojiMap = {
    'smile': '😊',
    'simple_smile': '🙂',
    'laughing': '😆',
    'haha': '😆',
    'joy': '😂',
    'blush': '😊',
    'heart': '❤️',
    'heart_eyes': '😍',
    'thumbsup': '👍',
    'ok_hand': '👌',
    'fire': '🔥',
    'rocket': '🚀',
    'check': '✅',
    'white_check_mark': '✅',
    'warning': '⚠️',
    'pushpin': '📌',
    'imp': '👿',
    'thinking_face': '🤔',
    'eyes': '👀',
    'sob': '😭',
    'pray': '🙏',
    'raised_hands': '🙌',
    'clap': '👏',
    'tada': '🎉',
    'partying_face': '🥳',
    'sun': '☀️',
    'star': '⭐',
    'sparkles': '✨',
    'light_bulb': '💡',
    'x': '❌',
    'no_entry': '⛔',
    'see_no_evil': '🙈',
    'hear_no_evil': '🙉',
    'speak_no_evil': '🙊',
    'point_up': '☝️',
    'v': '✌️',
    'muscle': '💪',
    'moneybag': '💰',
    'gift': '🎁',
    'birthday': '🎂',
    'coffee': '☕',
    'beer': '🍺',
    'pizza': '🍕',
    'taco': '🌮',
    'hamburger': '🍔',
    'fries': '🍟',
    'sushi': '🍣',
    'cake': '🍰',
};

export const parseEmoji = (text) => {
    if (!text) return '';

    // :shortcode: 패턴을 찾아서 매핑된 이모지가 있으면 치환
    return text.replace(/:([a-z0-9_+-]+):/g, (match, p1) => {
        return emojiMap[p1] || match; // 매핑 없으면 원래 문자열 그대로 반환
    });
};
