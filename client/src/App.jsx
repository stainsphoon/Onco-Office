import { useState, useCallback, useEffect, useRef } from 'react'
import { ChevronLeft, MessageSquare, ThumbsUp, ThumbsDown, MoreHorizontal, Send, SmilePlus } from 'lucide-react'
import GameContainer from './components/GameContainer'
import AvatarCustomizer from './components/AvatarCustomizer'
import ContextMenu from './components/ContextMenu'
import FieldOverlay from './components/FieldOverlay'
import ChatWindow from './components/ChatWindow'
import EmojiPickerButton from './components/EmojiPickerButton'
import { parseEmoji } from './utils/emoji'
import './App.css'

function App() {
  const [isCustomizing, setIsCustomizing] = useState(false); // 잠시 false로 두어 깜빡임 방지
  const [avatarData, setAvatarData] = useState(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('avatarData');
      if (saved) {
        setAvatarData(JSON.parse(saved));
        setIsCustomizing(false);
      } else {
        setIsCustomizing(true);
      }
    } catch (e) {
      setIsCustomizing(true);
    }
  }, []);
  const [contextMenu, setContextMenu] = useState(null);
  const [currentZone, setCurrentZone] = useState(null);
  const [activeSideView, setActiveSideView] = useState(null); // 'history', 'slack', null
  const [showThreadModal, setShowThreadModal] = useState(false);
  const [showChannelToast, setShowChannelToast] = useState(false);
  const [threadPosts, setThreadPosts] = useState([]);
  const [selectedPost, setSelectedPost] = useState(null); // null이면 목록뷰, 객체면 코멘트 상세뷰
  const [threadReplies, setThreadReplies] = useState([]);
  const [messages, setMessages] = useState([]);
  const [slackChannels, setSlackChannels] = useState({ channels: [] });
  const [socket, setSocket] = useState(null);
  const [favoriteChannels, setFavoriteChannels] = useState(() => {
    try { return JSON.parse(localStorage.getItem('favoriteChannels') || '[]'); } catch { return []; }
  });
  const [channelSearch, setChannelSearch] = useState('');
  const [postSearch, setPostSearch] = useState('');
  const [feedAlert, setFeedAlert] = useState(null);
  const isSendingRef = useRef(false); // [중복 방지] 발송 중 상태 제어 (동시 요청 즉각 차단용)
  const [isSendingUI, setIsSendingUI] = useState(false); // UI 비활성화용

  const handleSaveAvatar = (data) => {
    setAvatarData(data);
    localStorage.setItem('avatarData', JSON.stringify(data));
    setIsCustomizing(false);
  };

  const handleAction = (type) => {
    if (type === 'slack_dm') {
      setActiveSideView('history');
    }
    setContextMenu(null);
  };

  const handleSendMessage = (text) => {
    if (socket && !isSendingRef.current) {
      isSendingRef.current = true;
      setIsSendingUI(true);

      const requestId = `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      if (selectedPost) {
        // 특정 게시글(스레드)이 선택된 상태라면 코멘트로 전송
        const channelId = currentZone.zoneId;
        console.log(`[Client] handleSendMessage (REPLY) - Req: ${requestId}, TS: ${selectedPost.ts}`);
        socket.emit('createThreadReply', {
          channelId: channelId,
          threadTs: selectedPost.ts,
          text: text,
          requestId: requestId
        });
      } else {
        // 일반 메시지 전송
        console.log(`[Client] handleSendMessage (ZONE) - Req: ${requestId}, Zone: ${currentZone?.name}`);
        socket.emit('zoneMessage', { text, requestId });
      }

      // 2초 후 발송 제한 해제 (안전 장치 강화)
      setTimeout(() => {
        isSendingRef.current = false;
        setIsSendingUI(false);
      }, 2000);
    }
  };

  // Phaser로부터 이벤트를 받기 위한 리스너 설정
  useEffect(() => {
    const handleShowMenu = (e) => {
      const { x, y, user } = e.detail;
      setContextMenu({ x, y, targetUser: user });
    };

    const handleZoneNotify = (e) => {
      const { name, type, parentSection, isNewChannel, zoneId } = e.detail;
      console.log(`[App] Zone notified: ${name} (${type}), parent: ${parentSection}, isNew: ${isNewChannel}, zoneId: ${zoneId}`);

      setCurrentZone({ name, type, parentSection, zoneId });

      // 구역 이동 알림 토스트 (신규 구역 진입 시)
      if (isNewChannel) {
        setShowChannelToast(true);
        const timer = setTimeout(() => setShowChannelToast(false), 3000);
        // 타이머 관리는 간단히 시퀀스로 처리
      }

      if (type !== 'thread') {
        setShowThreadModal(false);
      }
    };

    const handleSocketReady = (e) => {
      setSocket(e.detail);
    };

    window.addEventListener('phaser-context-menu', handleShowMenu);
    window.addEventListener('phaser-zone-notify', handleZoneNotify);
    window.addEventListener('socket-ready', handleSocketReady);

    return () => {
      window.removeEventListener('phaser-context-menu', handleShowMenu);
      window.removeEventListener('phaser-zone-notify', handleZoneNotify);
      window.removeEventListener('socket-ready', handleSocketReady);
    };
  }, []);

  // 서버로부터 새 메시지 수신 (기본 소켓 리스너 - socket 변경 시에만 재등록)
  useEffect(() => {
    if (!socket) return;

    socket.on('newZoneMessage', (msg) => {
      setMessages(prev => [...prev, msg]);
    });

    socket.on('slackChannels', (data) => {
      setSlackChannels(data);
      if (Array.isArray(data.starred_channel_ids)) {
        setFavoriteChannels(prev => {
          const next = [...new Set([...prev, ...data.starred_channel_ids])];
          localStorage.setItem('favoriteChannels', JSON.stringify(next));
          return next;
        });
      }
      window.dispatchEvent(new CustomEvent('sync-slack-channels', {
        detail: data
      }));
    });

    socket.on('slackTokenAuthorized', (token) => {
      console.log('Slack token received and saved to localStorage');
      if (token) {
        localStorage.setItem('slack_token', token);
        socket.emit('getSlackChannels');
      }
    });

    // 기존 저장된 토큰이 있으면 서버에 전송
    const savedToken = localStorage.getItem('slack_token');
    if (savedToken) {
      console.log('Sending saved Slack token to server');
      socket.emit('setSlackToken', savedToken);
      socket.emit('getSlackChannels');
    }

    return () => {
      socket.off('newZoneMessage');
      socket.off('slackChannels');
      socket.off('slackTokenAuthorized');
    };
  }, [socket]);

  // [핵심 수정] 스레드 관련 소켓 리스너 - currentZone 변경 시에도 최신 값 참조
  useEffect(() => {
    if (!socket) return;

    const handleThreadPosts = (data) => {
      const currentId = currentZone?.zoneId?.trim();
      const incomingId = data?.channelId?.trim();

      console.log(`[Socket] threadPostsData received - incoming: ${incomingId}, current: ${currentId}`);

      if (currentId && incomingId && currentId === incomingId) {
        console.log(`[Socket] ✅ Updating thread posts, count: ${data.posts?.length || 0}`);
        setThreadPosts(data.posts || []);
      } else {
        console.log(`[Socket] ⏭️ Ignored posts (channel mismatch)`);
      }
    };

    const handleThreadReplies = (data) => {
      setThreadReplies(data.replies || []);
    };

    const handleUpdateReactions = (data) => {
      if (!data || !data.threadTs) return;

      setSelectedPost(prev => {
        if (prev && prev.ts === data.threadTs) {
          return { ...prev, reactions: data.reactions || [] };
        }
        return prev;
      });

      setThreadReplies(prev => prev.map(reply =>
        reply.ts === data.threadTs ? { ...reply, reactions: data.reactions || [] } : reply
      ));

      setThreadPosts(prev => prev.map(post =>
        post.ts === data.threadTs ? { ...post, reactions: data.reactions || [] } : post
      ));
    };

    socket.on('threadPostsData', handleThreadPosts);
    socket.on('threadRepliesData', handleThreadReplies);
    socket.on('updateMessageReactions', handleUpdateReactions);

    return () => {
      socket.off('threadPostsData', handleThreadPosts);
      socket.off('threadRepliesData', handleThreadReplies);
      socket.off('updateMessageReactions', handleUpdateReactions);
    };
  }, [socket, currentZone]);

  // 모달이 열리면 채널의 스레드 목록(루트 게시물)을 불러옵니다.
  useEffect(() => {
    if (showThreadModal && currentZone?.type === 'thread' && socket) {
      // [수정] currentZone.name(표시 이름) 대신 currentZone.zoneId(Slack ID)를 사용
      const channelId = currentZone.zoneId;
      console.log(`[App] Fetching thread posts for channel: ${channelId}`);
      socket.emit('getThreadPosts', channelId);
    } else if (!showThreadModal) {
      // 닫힐 때 상태 초기화
      setSelectedPost(null);
      setThreadPosts([]);
      setThreadReplies([]);
    }
  }, [showThreadModal, currentZone, socket]);

  const handleTeleport = (channelId, displayName) => {
    window.dispatchEvent(new CustomEvent('teleport-to-zone', {
      detail: { name: channelId, displayName: displayName }
    }));
    setActiveSideView(null);
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        {/* 홈 아이콘: 온코월드(가상 서버) 범주에 속할 때 활성화 */}
        <div className={`icon-item ${(!currentZone || currentZone.parentSection === 'home') ? 'active' : ''}`} onClick={() => {
          window.dispatchEvent(new CustomEvent('teleport-to-zone', {
            detail: { name: 'OncoWorld', displayName: 'OncoWorld' }
          }));
          setActiveSideView(null);
        }}>🏠</div>

        {/* 슬랙 아이콘: 슬랙 채널 필드 또는 그 내부의 스레드 필드에 있을 때, 혹은 슬랙 패널이 열려 있을 때 활성화 */}
        <div className={`icon-item slack-icon-btn ${(currentZone?.parentSection === 'slack' || activeSideView === 'slack') ? 'active' : ''}`} onClick={() => {
          const nextState = activeSideView === 'slack' ? null : 'slack';
          setActiveSideView(nextState);
          if (nextState === 'slack' && socket) socket.emit('getSlackChannels');
        }}>
          <div style={{ width: '28px', height: '28px', display: 'flex' }}>
            <svg viewBox="0 0 122.8 122.8" xmlns="http://www.w3.org/2000/svg"><path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.4 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#e01e5a" /><path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.4c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36c5f0" /><path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.4 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C77.6 5.8 83.4 0 90.5 0s12.9 5.8 12.9 12.9v32.3z" fill="#2eb67d" /><path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.4c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ecb22e" /></svg>
          </div>
        </div>
        <div className="icon-item" onClick={() => setActiveSideView(null)}>📁</div>
        <div className="icon-item" onClick={() => setActiveSideView(null)}>⚙️</div>
        <div style={{ marginTop: 'auto' }} className="icon-item" onClick={() => setActiveSideView(null)}>❓</div>
      </aside>
      <main className="main-content">
        <header className="top-nav">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span>Avatar: <strong>{avatarData ? 'User_onco' : 'Guest'}</strong></span>
            {currentZone && (
              <span style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                📍 {currentZone.name} ({currentZone.parentSection})
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="slack-login-btn" onClick={() => {
              if (!socket || !socket.id) {
                return alert("서버와 연결 중입니다. 잠시만 기다려 주세요...");
              }
              const clientId = "2094976171682.10568580408610";
              const redirectUri = encodeURIComponent("https://0589-118-33-70-70.ngrok-free.app/slack/oauth_redirect");
              const scope = "identify,channels:read,channels:history,groups:read,groups:history,chat:write,users:read,im:read,mpim:read,stars:read";
              const state = socket.id;
              window.open(`https://slack.com/oauth/v2/authorize?client_id=${clientId}&user_scope=${scope}&redirect_uri=${redirectUri}&state=${state}`, '_blank');
            }}>Slack {slackChannels.channels?.length > 0 ? '재연동' : '연동'}</button>
            <button className="edit-btn" onClick={() => setIsCustomizing(true)}>아바타 편집</button>
          </div>
        </header>
        <div className="game-wrapper" style={{ position: 'relative', flex: 1 }}>
          {isCustomizing && <AvatarCustomizer onSave={handleSaveAvatar} />}

          {/* 채널 상단 토스트 알림 (3초 노출) */}
          {showChannelToast && currentZone?.type === 'slack' && (
            <div className="channel-toast">
              해당 Field는 <strong>{currentZone.name}</strong> 필드입니다.
            </div>
          )}

          {/* 사이드바 외부 클릭 시 닫기용 백드롭 */}
          {activeSideView && (
            <div className="sidebar-backdrop" onClick={() => setActiveSideView(null)} />
          )}

          {/* 채팅 히스토리 사이드 패널 */}
          {activeSideView === 'history' && (
            <div className="chat-history-sidebar">
              <div className="history-header">
                <h3>대화 히스토리</h3>
                <button onClick={() => setActiveSideView(null)}>×</button>
              </div>
              <div className="history-messages">
                {messages.length === 0 && <p style={{ textAlign: 'center', color: '#999', marginTop: '20px' }}>아직 대화 내역이 없습니다.</p>}
                {messages.map((msg, i) => (
                  <div key={i} className={`history-item ${msg.authorId === socket?.id ? 'mine' : ''}`}>
                    <span className="author">{msg.author}</span>
                    <p className="text">{msg.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={`slack-sidebar-container ${activeSideView === 'slack' ? 'open' : ''}`}>
            <div className="slack-sidebar-header">
              <h3>Slack</h3>
              <button className="close-btn" onClick={() => setActiveSideView(null)}>×</button>
            </div>
            <div className="slack-sidebar-content">
              {(!slackChannels?.channels || !Array.isArray(slackChannels.channels) || slackChannels.channels.length === 0) ? (
                <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                  <p style={{ fontSize: '14px', marginBottom: '15px', color: '#bcabbc' }}>슬랙 데이터가 없거나 불러오는 중입니다.</p>
                  <button className="slack-login-btn" style={{ width: '100%' }} onClick={() => {
                    const clientId = "2094976171682.10568580408610";
                    const redirectUri = encodeURIComponent("https://0589-118-33-70-70.ngrok-free.app/slack/oauth_redirect");
                    const scope = "identify,channels:read,channels:history,groups:read,groups:history,chat:write,users:read,im:read,mpim:read,stars:read";
                    const state = socket?.id;
                    window.open(`https://slack.com/oauth/v2/authorize?client_id=${clientId}&user_scope=${scope}&redirect_uri=${redirectUri}&state=${state}`, '_blank');
                  }}>Slack 인증하기</button>
                </div>
              ) : (() => {
                const allNonDm = slackChannels.channels.filter(ch => !ch.is_im);
                const searchLower = channelSearch.toLowerCase();
                const filtered = searchLower
                  ? allNonDm.filter(ch => (ch.display_name || ch.name || '').toLowerCase().includes(searchLower))
                  : allNonDm;

                const favIds = new Set(favoriteChannels);
                const favs = filtered.filter(ch => favIds.has(ch.id));
                const nonFavs = filtered.filter(ch => !favIds.has(ch.id));
                const newMsgs = nonFavs.filter(ch => ch.unread_count > 0 || ch.has_unreads);
                const publicChs = nonFavs.filter(ch => (ch.is_channel || ch.is_group) && !ch.is_private && !ch.is_mpim);
                const privateChs = nonFavs.filter(ch => ch.is_private || ch.is_mpim);

                const toggleFavorite = (chId) => {
                  setFavoriteChannels(prev => {
                    const next = prev.includes(chId) ? prev.filter(id => id !== chId) : [...prev, chId];
                    localStorage.setItem('favoriteChannels', JSON.stringify(next));
                    return next;
                  });
                };

                const renderChannel = (ch, i) => (
                  <div
                    key={ch.id || i}
                    className={`slack-item channel ${currentZone?.zoneId === ch.id ? 'active' : ''}`}
                    onClick={() => handleTeleport(ch.id, ch.is_private ? ch.display_name : ch.name)}
                  >
                    <span className="prefix">{ch.is_private ? '🔒' : '#'}</span>
                    <span className="name">{ch.display_name || ch.name}</span>
                    {(ch.unread_count > 0 || ch.has_unreads) && (
                      <span className="unread-badge">{ch.unread_count || '•'}</span>
                    )}
                    <button
                      className={`favorite-btn ${favoriteChannels.includes(ch.id) ? 'active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(ch.id); }}
                      title={favoriteChannels.includes(ch.id) ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                    >
                      {favoriteChannels.includes(ch.id) ? '★' : '☆'}
                    </button>
                  </div>
                );

                return (
                  <>
                    <div className="channel-search-wrapper">
                      <input
                        className="channel-search-input"
                        type="text"
                        placeholder="🔍 채널 검색..."
                        value={channelSearch}
                        onChange={(e) => setChannelSearch(e.target.value)}
                      />
                    </div>

                    {favs.length > 0 && (
                      <div className="slack-section">
                        <div className="section-header"><span className="section-name">⭐ Favorites</span></div>
                        {favs.map(renderChannel)}
                      </div>
                    )}

                    {newMsgs.length > 0 && (
                      <div className="slack-section">
                        <div className="section-header"><span className="section-name">💬 New Messages</span></div>
                        {newMsgs.sort((a, b) => (b.unread_count || 0) - (a.unread_count || 0)).map(renderChannel)}
                      </div>
                    )}

                    {publicChs.length > 0 && (
                      <div className="slack-section">
                        <div className="section-header"><span className="section-name"># Public Channels</span></div>
                        {publicChs.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '')).map(renderChannel)}
                      </div>
                    )}

                    {privateChs.length > 0 && (
                      <div className="slack-section">
                        <div className="section-header"><span className="section-name">🔒 Private Channels</span></div>
                        {privateChs.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '')).map(renderChannel)}
                      </div>
                    )}

                    {searchLower && filtered.length === 0 && (
                      <div style={{ padding: '30px 20px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                        '{channelSearch}'에 대한 검색 결과가 없습니다.
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          <div className={`bottom-chat-bar ${selectedPost ? 'reply-mode' : ''}`}>
            {selectedPost && (
              <div className="reply-indicator">
                <span className="reply-label">코멘트 작성 중:</span>
                <span className="reply-target">{selectedPost.text.replace('📌', '').trim().substring(0, 20)}...</span>
                <button className="cancel-reply-btn" onClick={() => setSelectedPost(null)}>취소</button>
              </div>
            )}
            <input
              type="text"
              className="chat-input-field"
              placeholder={selectedPost ? "이 스레드에 코멘트를 남기세요..." : `${currentZone?.name || 'OncoWorld'}에서 대화하기...`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.target.value.trim() && !isSendingRef.current) {
                  e.preventDefault();
                  handleSendMessage(e.target.value);
                  e.target.value = '';
                }
              }}
            />
            <EmojiPickerButton onEmojiSelect={(emoji) => {
              const input = document.querySelector('.chat-input-field');
              if (input) {
                const start = input.selectionStart || input.value.length;
                input.value = input.value.slice(0, start) + emoji + input.value.slice(start);
                setTimeout(() => {
                  input.focus();
                  input.setSelectionRange(start + emoji.length, start + emoji.length);
                }, 0);
              }
            }} />
            <button className="send-btn" disabled={isSendingUI} onClick={(e) => {
              const input = e.currentTarget.parentElement.querySelector('.chat-input-field');
              if (input.value.trim() && !isSendingRef.current) {
                handleSendMessage(input.value);
                input.value = '';
              }
            }}>전송</button>
            <button
              className={`history-toggle-btn ${activeSideView === 'history' ? 'active' : ''}`}
              onClick={() => setActiveSideView(prev => prev === 'history' ? null : 'history')}
              title="대화 히스토리"
            >
              💬
            </button>
          </div>

          <div className={`channel-toast ${showChannelToast ? 'visible' : ''}`}>
            해당 Field는 <strong>{currentZone?.name}</strong> 필드입니다.
          </div>

          <div className="field-overlay">
            <div
              className={`trigger-popup ${((currentZone?.type === 'thread' || currentZone?.zoneId === 'Jira Board') && !showThreadModal) ? 'visible' : ''}`}
              onClick={() => setShowThreadModal(true)}
            >
              <div className="trigger-icon">
                {currentZone?.zoneId === 'Jira Board' ? '📋' : '✏️'}
              </div>
              <div className="trigger-text">
                <h4>{currentZone?.zoneId === 'Jira Board' ? 'Jira 보드 보기' : '게시글 작성'}</h4>
                <p>{currentZone?.name} 히스토리 보기</p>
              </div>
            </div>
          </div>

          {showThreadModal && (
            <div className="modal-overlay" onClick={() => setShowThreadModal(false)}>
              <div className="modal-content thread-board-modal" onClick={e => e.stopPropagation()}>
                <button className="close-btn" onClick={() => setShowThreadModal(false)}>✕</button>
                {feedAlert && (
                  <div style={{
                    position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)',
                    background: '#10b981', color: 'white', padding: '8px 16px', borderRadius: '20px',
                    fontSize: '13px', fontWeight: 'bold', zIndex: 100, boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                  }}>
                    {feedAlert}
                  </div>
                )}
                <div className="thread-board-header">
                  {selectedPost ? (
                    <div className="header-detail-view" style={{ display: 'flex', alignItems: 'center', width: '100%', position: 'relative' }}>
                      <button className="back-btn-intuitive" onClick={() => setSelectedPost(null)}>
                        <ChevronLeft size={24} /> 뒤로가기
                      </button>
                      <h2 className="header-title-centered" style={{
                        position: 'absolute', left: '50%', transform: 'translateX(-50%)',
                        fontSize: '20px', fontWeight: '800', margin: 0
                      }}>코멘트 보기</h2>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', width: '100%' }}>
                      <h2 style={{ margin: 0, whiteSpace: 'nowrap' }}>📋 {currentZone?.name}</h2>
                      <input
                        type="text"
                        className="channel-search-input"
                        placeholder="🔍 게시글 검색..."
                        value={postSearch}
                        onChange={(e) => setPostSearch(e.target.value)}
                        style={{ flex: 1, maxWidth: '250px', fontSize: '13px', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }}
                      />
                    </div>
                  )}
                </div>

                <div className="thread-board-body">
                  {!selectedPost ? (
                    <div className="comment-view">
                      <div className="comment-list">
                        {threadPosts.length === 0 ? (
                          <div className="empty-state">
                            아직 작성된 메인 피드가 없습니다.<br />
                            하단 입력창을 통해 가장 먼저 스레드를 시작해 보세요!
                          </div>
                        ) : (
                          <div className="post-list">
                            {threadPosts.filter(post => {
                              if (!postSearch.trim()) return true;
                              const cleanText = post.text.replace(/^(:pushpin:|📌)\s*/i, '').replace(/\s*-\s*Thread$/i, '').trim();
                              return cleanText.toLowerCase().includes(postSearch.trim().toLowerCase());
                            }).map((post, idx) => (
                              <div key={idx} className="post-list-item" onClick={() => {
                                setSelectedPost(post);
                                socket.emit('getThreadReplies', {
                                  channelId: currentZone.zoneId,
                                  threadTs: post.ts
                                });
                              }}>
                                <div className="post-title">{post.text.replace(/^(:pushpin:|📌)\s*/i, '').replace(/\s*-\s*Thread$/i, '').trim() || '내용 없음'}</div>
                                <div className="post-meta">
                                  코멘트 {post.reply_count || 0}개 • {new Date(post.ts * 1000).toLocaleString()}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="comment-input-area">
                        <input
                          type="text"
                          className="main-post-input"
                          placeholder="새로운 주제를 작성하세요..."
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.target.value.trim() && socket && !isSendingRef.current) {
                              isSendingRef.current = true;
                              setIsSendingUI(true);
                              e.preventDefault();
                              e.stopPropagation();

                              const title = e.target.value.trim();
                              const channelId = currentZone.zoneId;
                              const requestId = `post_${Date.now()}_${Math.random().toString(36).substring(7)}`;

                              e.target.value = '';
                              console.log(`[Client] createMainPost (Enter) - Req: ${requestId}`);
                              socket.emit('createMainPost', { channelId, text: title, requestId });

                              setFeedAlert('메인 피드가 등록되었습니다 ✅');
                              setTimeout(() => {
                                setFeedAlert(null);
                                isSendingRef.current = false;
                                setIsSendingUI(false);
                              }, 2000);
                            }
                          }}
                        />
                        <EmojiPickerButton onEmojiSelect={(emoji) => {
                          const input = document.querySelector('.main-post-input');
                          if (input) {
                            const start = input.selectionStart || input.value.length;
                            input.value = input.value.slice(0, start) + emoji + input.value.slice(start);
                            setTimeout(() => {
                              input.focus();
                              input.setSelectionRange(start + emoji.length, start + emoji.length);
                            }, 0);
                          }
                        }} />
                        <button
                          className="send-comment-btn"
                          disabled={isSendingUI}
                          onClick={(e) => {
                            const inputList = e.currentTarget.closest('.comment-input-area').querySelector('.main-post-input');
                            if (inputList.value.trim() && socket && !isSendingRef.current) {
                              isSendingRef.current = true;
                              setIsSendingUI(true);

                              const title = inputList.value.trim();
                              const channelId = currentZone.zoneId;
                              const requestId = `post_${Date.now()}_${Math.random().toString(36).substring(7)}`;

                              console.log(`[Client] createMainPost (Click) - Req: ${requestId}`);
                              socket.emit('createMainPost', { channelId, text: title, requestId });
                              inputList.value = '';

                              setFeedAlert('메인 피드가 등록되었습니다 ✅');
                              setTimeout(() => {
                                setFeedAlert(null);
                                isSendingRef.current = false;
                                setIsSendingUI(false);
                              }, 2000);
                            }
                          }}>등록</button>
                      </div>
                    </div>
                  ) : (
                    <div className="comment-view">
                      <div className="comment-list" style={{ flex: 1, overflowY: 'auto' }}>
                        <div className="root-post-card">
                          <div className="post-badge">POST</div>
                          <div className="comment-item root-comment" style={{ gap: '12px' }}>
                            <div className="comment-avatar" style={{ width: '40px', height: '40px', background: '#e2e8f0' }}></div>
                            <div className="comment-content">
                              <span className="comment-author" style={{ fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>메인 피드 작성자</span>
                              <p style={{ fontWeight: '500', margin: '4px 0', fontSize: '15px', color: '#1e293b', lineHeight: '1.4' }}>
                                {parseEmoji(selectedPost.text.replace(/^(:pushpin:|📌)\s*/i, '').replace(/\s*-\s*Thread$/i, '').trim())}
                              </p>
                              <div className="post-meta" style={{ fontSize: '11px', color: '#64748b' }}>{new Date(selectedPost.ts * 1000).toLocaleString()}</div>

                              {/* 메인 피드 이모지 반응 영역 */}
                              <div className="reactions-container">
                                {selectedPost.reactions?.map((r, idx) => (
                                  <div key={idx} className="reaction-badge" title={r.name}>
                                    <span>{parseEmoji(`:${r.name}:`)}</span>
                                    <span className="reaction-count">{r.count}</span>
                                  </div>
                                ))}
                                <EmojiPickerButton
                                  returnFullObject={true}
                                  buttonClassName="add-reaction-btn"
                                  icon={<SmilePlus size={14} />}
                                  title="반응 추가"
                                  onEmojiSelect={(emojiObj) => {
                                    socket.emit('addReaction', {
                                      channelId: currentZone.zoneId,
                                      threadTs: selectedPost.ts,
                                      emoji: emojiObj.id
                                    });
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="replies-header">
                          <MessageSquare size={14} /> <span>Comments</span>
                        </div>

                        <div className="thread-replies-container">
                          {threadReplies.map((reply, i) => (
                            <div key={i} className="comment-item" style={{ display: 'flex', gap: '12px' }}>
                              <div className="comment-avatar"></div>
                              <div className="comment-content">
                                <span className="comment-author" style={{ fontWeight: '600', fontSize: '13px' }}>User {reply.user?.substring(0, 4) || 'UKNW'}</span>
                                <p style={{ margin: '3px 0', fontSize: '14px', color: '#334155' }}>{parseEmoji(reply.text)}</p>
                                <div className="post-meta" style={{ fontSize: '10px', color: '#94a3b8' }}>{new Date(reply.ts * 1000).toLocaleString()}</div>

                                {/* 코멘트 이모지 반응 영역 */}
                                <div className="reactions-container">
                                  {reply.reactions?.map((r, idx) => (
                                    <div key={idx} className="reaction-badge" title={r.name}>
                                      <span>{parseEmoji(`:${r.name}:`)}</span>
                                      <span className="reaction-count">{r.count}</span>
                                    </div>
                                  ))}
                                  <EmojiPickerButton
                                    returnFullObject={true}
                                    buttonClassName="add-reaction-btn"
                                    icon={<SmilePlus size={14} />}
                                    title="반응 추가"
                                    onEmojiSelect={(emojiObj) => {
                                      socket.emit('addReaction', {
                                        channelId: currentZone.zoneId,
                                        threadTs: reply.ts,
                                        emoji: emojiObj.id
                                      });
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                          {threadReplies.length === 0 && (
                            <p style={{ textAlign: 'center', color: '#94a3b8', padding: '30px 0', fontSize: '14px' }}>아직 이어지는 코멘트가 없습니다.</p>
                          )}
                        </div>
                      </div>

                      <div className="comment-input-area" style={{
                        display: 'flex', gap: '10px', padding: '15px', borderTop: '1px solid #f1f5f9', background: '#fff'
                      }}>
                        <input
                          type="text"
                          className="reply-input"
                          placeholder="덧글을 입력하세요..."
                          style={{ flex: 1, padding: '10px 15px', borderRadius: '20px', border: '1px solid #e2e8f0', outline: 'none' }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.target.value.trim() && socket && !isSendingRef.current) {
                              isSendingRef.current = true;
                              setIsSendingUI(true);
                              const text = e.target.value.trim();
                              const channelId = currentZone.zoneId;
                              const requestId = `reply_${Date.now()}_${Math.random().toString(36).substring(7)}`;

                              socket.emit('createThreadReply', {
                                channelId,
                                threadTs: selectedPost.ts,
                                text: text,
                                requestId: requestId
                              });
                              e.target.value = '';
                              setTimeout(() => {
                                isSendingRef.current = false;
                                setIsSendingUI(false);
                              }, 2000);
                            }
                          }}
                        />
                        <EmojiPickerButton onEmojiSelect={(emoji) => {
                          const input = document.querySelector('.reply-input');
                          if (input) {
                            const start = input.selectionStart || input.value.length;
                            input.value = input.value.slice(0, start) + emoji + input.value.slice(start);
                            setTimeout(() => {
                              input.focus();
                              input.setSelectionRange(start + emoji.length, start + emoji.length);
                            }, 0);
                          }
                        }} />
                        <button
                          className="send-comment-btn"
                          disabled={isSendingUI}
                          onClick={(e) => {
                            const input = e.currentTarget.closest('.comment-input-area').querySelector('.reply-input');
                            if (input.value.trim() && socket && !isSendingRef.current) {
                              isSendingRef.current = true;
                              setIsSendingUI(true);
                              const text = input.value.trim();
                              const channelId = currentZone.zoneId;
                              const requestId = `reply_${Date.now()}_${Math.random().toString(36).substring(7)}`;

                              socket.emit('createThreadReply', {
                                channelId,
                                threadTs: selectedPost.ts,
                                text,
                                requestId
                              });
                              input.value = '';
                              setTimeout(() => {
                                isSendingRef.current = false;
                                setIsSendingUI(false);
                              }, 2000);
                            }
                          }}
                        >등록</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        <GameContainer avatarData={avatarData} />
      </main>
    </div>
  );
}

export default App;
