const { WebClient } = require('@slack/web-api');
require('dotenv').config();

// 슬랙 클라이언트 초기화 (기본용)
const slackToken = process.env.SLACK_BOT_TOKEN;
const defaultWeb = slackToken ? new WebClient(slackToken) : null;

/**
 * 슬랙으로 메시지를 전송합니다.
 * @param {string} channel - 채널 ID
 * @param {string} text - 메시지 내용
 * @param {string} threadTs - (옵션) 스레드 타임스탬프
 * @param {string} userToken - (옵션) 사용자별 xoxp 토큰
 */
async function sendMessageToSlack(channel, text, threadTs = null, userToken = null) {
    const client = userToken ? new WebClient(userToken) : defaultWeb;

    if (!client) {
        console.warn('Slack client not initialized. Mocking message send:', text);
        return { ok: true, ts: `mock-ts-${Date.now()}` };
    }

    try {
        const params = {
            channel: channel,
            text: text
        };
        if (threadTs) {
            params.thread_ts = threadTs;
        }
        const result = await client.chat.postMessage(params);
        return result;
    } catch (error) {
        console.error('Slack API Error:', error);
        throw error;
    }
}

/**
 * 현재 토큰(봇 또는 사용자)이 참여하고 있는 채널 목록만 가져옵니다.
 */
async function listChannels(token = null) {
    const client = token ? new WebClient(token) : defaultWeb;
    if (!client) return { channels: [] };
    try {
        console.log('[Slack] Fetching conversations and users...');

        const [convResult, usersResult, starsResult] = await Promise.all([
            client.users.conversations({
                types: 'public_channel,private_channel,im,mpim',
                limit: 1000
            }).catch(err => {
                console.warn('[Slack] Conversations fetch error:', err.message);
                return { ok: false };
            }),
            client.users.list({ limit: 1000 }).catch(() => ({ ok: false })),
            client.stars.list({ limit: 100 }).catch(err => {
                console.warn('[Slack] Stars fetch error:', err.message);
                return { ok: false };
            })
        ]);

        if (!convResult || !convResult.ok) {
            console.error('[Slack] Initial channel sync failed. This is usually due to missing scopes (channels:read, groups:read, etc.) on the BOT token, or the token is invalid.');
            return { channels: [], starred_channel_ids: [] };
        }

        const userMap = {};
        if (usersResult && usersResult.ok && usersResult.members) {
            usersResult.members.forEach(u => {
                userMap[u.id] = u.real_name || u.name;
            });
        }

        const rawChannels = convResult.channels || [];

        // 채널 맵핑 (unread_count, num_members 등 원본 데이터 보존)
        const enhancedChannels = rawChannels.map(ch => {
            if (ch.is_im && ch.user) {
                return { ...ch, display_name: userMap[ch.user] || `User ${ch.user}` };
            }
            return { ...ch, display_name: ch.name || ch.id };
        });

        // 즐겨찾기(Starred) 채널 ID 목록 추출
        const starredIds = [];
        if (starsResult && starsResult.ok && starsResult.items) {
            starsResult.items.forEach(item => {
                if (item.type === 'channel' || item.type === 'group') {
                    starredIds.push(item.channel);
                }
            });
        }

        console.log(`[Slack] Successfully synced ${enhancedChannels.length} channels and ${starredIds.length} starred items.`);
        return {
            channels: enhancedChannels,
            starred_channel_ids: starredIds
        };
    } catch (error) {
        console.error('Error listing channels:', error);
        return { channels: [] };
    }
}

/**
 * OAuth 코드를 액세스 토큰으로 교환합니다.
 */
async function exchangeCodeForToken(code) {
    const client = new WebClient(); // 초기화 없이 사용
    try {
        const client_id = process.env.SLACK_CLIENT_ID.trim();
        const client_secret = process.env.SLACK_CLIENT_SECRET.trim();
        const redirect_uri = process.env.SLACK_REDIRECT_URI.trim();

        console.log('--- Slack OAuth Token Exchange ---');
        console.log(`Code: ${code.substring(0, 5)}...`);
        console.log(`Client ID: ${client_id.substring(0, 10)}...`);
        console.log(`Redirect URI: ${redirect_uri}`);
        console.log('---------------------------------');

        console.log(`Sending to Slack: clientId=${client_id.substring(0, 5)}..., redirect_uri='${redirect_uri}'`);

        const result = await client.oauth.v2.access({
            client_id: client_id,
            client_secret: client_secret,
            code: code,
            redirect_uri: redirect_uri
        });
        return result; // access_token (xoxp-...) 포함됨
    } catch (error) {
        console.error('OAuth token exchange error:', error);
        throw error;
    }
}

/**
 * 구역 진입 시 해당 구역의 슬랙 채널을 식별합니다. (임시 매핑)
 */
function getChannelForZone(zoneName) {
    const mapping = {
        '로비': process.env.CHANNEL_GENERAL || 'C12345678',
        'OncoWorld': process.env.CHANNEL_GENERAL || 'C12345678',
        'Jira Board': process.env.CHANNEL_JIRA || 'C87654321'
    };

    // 고정 매핑 확인
    if (mapping[zoneName]) return mapping[zoneName];

    // 스레드 필드 패턴인 경우 (예: C12345678-thread-1)
    if (zoneName.includes('-thread-')) {
        return zoneName.split('-thread-')[0]; // 베이스 채널 ID 반환
    }

    // 일반 슬랙 채널 ID인 경우 그대로 반환
    // 이제 Phaser에서 zone.name을 ch.id로 설정하므로 100% 매칭됨
    return zoneName;
}

/**
 * 특정 채널의 '게시글(루트 메시지)' 목록을 가져옵니다. (📌 마커로 시작하는 메시지들)
 */
async function getChannelPosts(channel, token = null) {
    const client = token ? new WebClient(token) : defaultWeb;
    if (!client) {
        console.error('[getChannelPosts] No client available!');
        return { ok: false, posts: [] };
    }

    try {
        console.log(`[getChannelPosts] Fetching history for channel: ${channel}, using token: ${token ? 'user' : 'bot'}`);
        const result = await client.conversations.history({
            channel: channel,
            limit: 100
        });

        console.log(`[getChannelPosts] API result.ok: ${result.ok}, messages count: ${result.messages?.length || 0}`);

        if (result.ok && result.messages) {
            // 처음 5개 메시지의 텍스트 시작 부분을 로깅하여 마커 확인
            result.messages.slice(0, 5).forEach((msg, i) => {
                const textPreview = msg.text ? msg.text.substring(0, 50) : '(no text)';
                const startsWithPin = msg.text ? msg.text.startsWith('📌') : false;
                console.log(`[getChannelPosts] Msg[${i}]: "${textPreview}" | startsWith📌: ${startsWithPin} | charCode[0]: ${msg.text ? msg.text.charCodeAt(0) : 'N/A'}`);
            });

            // [핵심 수정] Slack API는 📌 이모지를 :pushpin: 텍스트로 변환하여 반환함
            // 양쪽 형식 모두 체크해야 함
            const posts = result.messages.filter(msg =>
                msg.text && (msg.text.startsWith('📌') || msg.text.startsWith(':pushpin:'))
            );
            console.log(`[getChannelPosts] Filtered posts count: ${posts.length}`);
            return { ok: true, posts };
        }
        console.log(`[getChannelPosts] API returned ok:false or no messages`);
        return { ok: false, posts: [] };
    } catch (error) {
        console.error('[getChannelPosts] Error:', error.message, error.data || '');
        return { ok: false, error: error.message };
    }
}

/**
 * 특정 스레드(게시글)에 달린 코멘트(답글) 목록을 가져옵니다.
 */
async function getThreadReplies(channel, threadTs, token = null) {
    const client = token ? new WebClient(token) : defaultWeb;
    if (!client) return { ok: false, replies: [] };

    try {
        const result = await client.conversations.replies({
            channel: channel,
            ts: threadTs,
            limit: 100
        });

        if (result.ok && result.messages) {
            // 원본 메시지(루트)는 제외하고 답글만 반환
            const replies = result.messages.filter(msg => msg.ts !== threadTs);
            return { ok: true, replies };
        }
        return { ok: false, replies: [] };
    } catch (error) {
        console.error('getThreadReplies Error:', error);
        return { ok: false, error: error.message };
    }
}

/**
 * 특정 메시지에 이모지 반응을 추가합니다.
 */
async function addReaction(channel, ts, emoji, token = null) {
    const client = token ? new WebClient(token) : defaultWeb;
    if (!client) return { ok: false };
    try {
        const result = await client.reactions.add({
            channel: channel,
            timestamp: ts,
            name: emoji.replace(/:/g, '') // :smile: -> smile 형식으로 변환 루틴 추가 제언
        });
        return result;
    } catch (error) {
        // 이미 해당 이모지가 달린 경우(already_reacted) 에러가 발생할 수 있음
        if (error.data && error.data.error === 'already_reacted') {
            return { ok: true, already_reacted: true };
        }
        console.error('addReaction Error:', error);
        return { ok: false, error: error.message };
    }
}

/**
 * 특정 메시지의 이모지 반응 목록을 가져옵니다.
 */
async function getReactions(channel, ts, token = null) {
    const client = token ? new WebClient(token) : defaultWeb;
    if (!client) return { ok: false, reactions: [] };
    try {
        const result = await client.reactions.get({
            channel: channel,
            timestamp: ts,
            full: true
        });
        if (result.ok && result.message && result.message.reactions) {
            return { ok: true, reactions: result.message.reactions };
        }
        return { ok: true, reactions: [] };
    } catch (error) {
        console.error('getReactions Error:', error);
        return { ok: false, error: error.message };
    }
}

module.exports = {
    sendMessageToSlack,
    getChannelForZone,
    listChannels,
    exchangeCodeForToken,
    getChannelPosts,
    getThreadReplies,
    addReaction,
    getReactions
};
