(function () {
    'use strict';
    const h = React.createElement;
    const readKey = (leagueId, teamId) => `tl-rival-read:${leagueId}:${teamId}`;
    function readIds(leagueId, teamId) {
        try {
            const ids = JSON.parse(localStorage.getItem(readKey(leagueId, teamId)) || '[]');
            return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [];
        } catch (_) { return []; }
    }
    // Replies are saved immediately; only their presentation waits. Leaving a
    // conversation or refreshing cannot lose a reply or restart an old one.
    function presentation(league, now = Date.now()) {
        const typing = [];
        const rivalMessages = (league?.rivalMessages || []).filter(message => {
            const sentAt = Date.parse(message.createdAt);
            const readyAt = sentAt + Math.min(2800, 1400 + (message.text?.length || 0) * 15);
            if (message.id?.startsWith('reply:') && league.teams.some(team => team.teamId === message.fromTeamId && team.manager === 'ai')
                && Number.isFinite(sentAt) && sentAt <= now + 10000 && readyAt > now) {
                typing.push({ ...message, readyAt });
                return false;
            }
            return true;
        });
        return { league: typing.length ? { ...league, rivalMessages } : league, typing, nextAt: typing.length ? Math.min(...typing.map(message => message.readyAt)) : null };
    }
    function unreadMessages(league, teamId, ids, throughWeek) {
        return (window.App.TimeLeagueRivals?.messagesFor(league, teamId, { throughWeek }) || [])
            .filter(message => message.toTeamId === teamId && !ids.includes(message.id));
    }
    // Planning decisions are already known when the following game begins.
    // A replay cap hides later decisions without erasing that pregame context.
    function tradesForConversation(league, teamId, otherTeamId, throughWeek) {
        if (!league.teams.some(team => team.teamId === teamId && team.manager === 'human')) return [];
        const actionWeek = Math.max(1, league.currentWeek - (league.weekStage === 'postgame' ? 1 : 0));
        const horizon = Number.isInteger(throughWeek) ? Math.min(actionWeek, throughWeek + 1) : actionWeek;
        const names = new Map();
        const remember = entry => { if (entry?.entryId && entry.name) names.set(entry.entryId, entry.name); };
        (league.draftPicks || []).forEach(remember);
        (league.finalizedWeeks || []).filter(week => !Number.isInteger(throughWeek) || week.week <= throughWeek).forEach(week => {
            (week.results || []).forEach(result => [...(result.starters || []), ...(result.bench || [])].forEach(remember));
            (week.playerProduction || []).forEach(remember);
        });
        league.teams.forEach(team => (team.roster || []).forEach(remember));
        return (league.trades || []).filter(trade =>
            ((trade.fromTeamId === teamId && trade.toTeamId === otherTeamId) || (trade.toTeamId === teamId && trade.fromTeamId === otherTeamId))
            && (trade.week || 1) <= horizon && (!trade.respondedWeek || trade.respondedWeek <= horizon)
            && ['pending', 'accepted', 'rejected', 'withdrawn'].includes(trade.status))
            .map((trade, index) => ({
                trade, index,
                sent: trade.fromTeamId === teamId,
                status: trade.status === 'pending' ? trade.deferredUntilWeek > horizon ? `Deferred until Week ${trade.deferredUntilWeek}` : trade.fromTeamId === teamId ? 'Awaiting their response' : 'Awaiting your response'
                    : trade.status === 'accepted' ? 'Accepted' : trade.status === 'rejected' ? 'Rejected' : 'Withdrawn',
                give: (trade.giveEntryIds || []).map(id => names.get(id) || 'Unavailable player'),
                receive: (trade.receiveEntryIds || []).map(id => names.get(id) || 'Unavailable player'),
            })).sort((a, b) => (b.trade.respondedWeek || b.trade.week || 1) - (a.trade.respondedWeek || a.trade.week || 1) || b.index - a.index);
    }
    function ConversationTrades({ rows, otherName, onTrades, onNavigate }) {
        if (!rows.length) return null;
        const pending = rows.filter(row => row.trade.status === 'pending').length;
        return h('details', { className: 'tl-chat-trades' },
            h('summary', null, `Trade proposals · ${rows.length}`, h('span', null, pending ? `${pending} pending` : 'Saved outcomes')),
            h('div', { className: 'tl-chat-trade-list', role: 'region', 'aria-label': `Trades with ${otherName}` }, rows.map(row => h('article', { key: row.trade.tradeId, className: 'tl-chat-proposal', 'aria-label': `${row.sent ? 'Sent' : 'Received'} trade · ${row.status}` },
                h('header', null, h('small', null, `${row.sent ? 'You proposed' : `${otherName} proposed`} · Week ${row.trade.week || 1}`), h('strong', null, row.status)),
                h('dl', null,
                    h('div', null, h('dt', null, 'You send'), h('dd', null, (row.sent ? row.give : row.receive).join(', ') || 'No players recorded')),
                    h('div', null, h('dt', null, 'You receive'), h('dd', null, (row.sent ? row.receive : row.give).join(', ') || 'No players recorded'))),
                row.trade.respondedWeek ? h('small', { className: 'tl-chat-proposal-saved' }, `Outcome saved in Week ${row.trade.respondedWeek}`) : null,
                (onTrades || onNavigate) ? h('button', { type: 'button', className: 'tl-chat-trade', onClick: () => onTrades ? onTrades(row.trade.tradeId) : onNavigate('trades'), 'aria-label': `Review ${row.sent ? 'sent' : 'received'} trade with ${otherName} from Week ${row.trade.week || 1}` }, 'Review trade →') : null))));
    }
    function WrTimeLeagueMailNotice({ league, message, count, onOpen }) {
        const sender = league.teams.find(team => team.teamId === message?.fromTeamId);
        if (!sender) return null;
        return h('section', { className: 'tl-mail-notice', role: 'status', 'aria-live': 'polite', 'aria-atomic': true },
            h('button', { type: 'button', className: 'tl-mail-notice-open', onClick: () => onOpen(sender.teamId), 'aria-label': `Read message from ${sender.name}` },
                window.TimeLeagueHelmetIcon ? h(window.TimeLeagueHelmetIcon, { helmet: sender.helmet, letter: window.App.TimeLeagueHelmet?.monogramFor(sender.name), size: 44 }) : h('span', { className: 'tl-mail-notice-icon', 'aria-hidden': true }, '✉'),
                h('span', { className: 'tl-mail-notice-copy' }, h('small', null, 'NEW MESSAGE'), h('strong', null, `${sender.name} sent you a message`), h('span', null, message.text)),
                h('span', { className: 'tl-mail-notice-link', 'aria-hidden': true }, 'Read & reply →')),
            count > 1 ? h('button', { type: 'button', className: 'tl-mail-notice-all', onClick: () => onOpen() }, `${count} unread · Open inbox`) : null);
    }
    window.TimeLeagueMail = { readKey, readIds, unreadMessages, presentation, tradesForConversation };
    window.WrTimeLeagueMailNotice = WrTimeLeagueMailNotice;
    function WrTimeLeagueRivalsPanel({ league, teamId, throughWeek, onTrades, compact = false, onNavigate, onSend, saving = false, isPrivate = false, threadRequest, onOpenThread, onRead }) {
        const R = window.App.TimeLeagueRivals;
        const storageKey = `tl-rival-read:${league.leagueId}:${teamId}`;
        const [readState, setReadState] = React.useState({});
        const [selection, setSelection] = React.useState(null);
        const [drafts, setDrafts] = React.useState({});
        const [replyVariants, setReplyVariants] = React.useState({});
        const [sending, setSending] = React.useState(false);
        const [error, setError] = React.useState(null);
        const [, refreshMail] = React.useState(0);
        const mail = presentation(league);
        React.useEffect(() => {
            if (!mail.nextAt) return undefined;
            const timer = window.setTimeout(() => refreshMail(value => value + 1), Math.max(0, mail.nextAt - Date.now()));
            return () => window.clearTimeout(timer);
        }, [storageKey, mail.nextAt]);
        const endRef = React.useRef(null);
        const inboxRef = React.useRef(null);
        const sendingRef = React.useRef(false);
        React.useEffect(() => {
            try { setReadState({ key: storageKey, ids: JSON.parse(localStorage.getItem(storageKey) || '[]') }); }
            catch (_) { setReadState({ key: storageKey, ids: [] }); }
        }, [storageKey]);
        const read = readState.key === storageKey && Array.isArray(readState.ids) ? readState.ids : [];
        const threads = R.threadsFor(mail.league, teamId, { throughWeek });
        const messages = threads.flatMap(thread => thread.messages).filter(message => message.toTeamId === teamId);
        const unread = messages.filter(message => !read.includes(message.id)).length;
        const selectedId = selection?.key === storageKey ? selection.teamId : null;
        const active = threads.find(thread => thread.team.teamId === selectedId) || threads[0];
        const activeTrades = active ? tradesForConversation(league, teamId, active.team.teamId, throughWeek) : [];
        const isTyping = mail.typing.some(message => message.fromTeamId === active?.team.teamId && message.toTeamId === teamId);
        const draftKey = `${storageKey}:${active?.team.teamId || ''}`;
        const draft = drafts[draftKey] || { text: '', tone: 'neutral', messageId: '' };
        const suggestedReplies = active ? R.quickRepliesFor(mail.league, teamId, active.team.teamId, { throughWeek, variant: replyVariants[draftKey] || 0 }) : [];
        const relationship = active?.relationship;
        const affinity = relationship ? 6 - relationship.heat : 6;
        const pending = saving || sending;
        const markRead = ids => {
            const next = [...new Set([...readIds(league.leagueId, teamId), ...read, ...ids])];
            setReadState({ key: storageKey, ids: next });
            try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch (_) { /* Session still works without storage. */ }
            onRead?.(storageKey, next);
        };
        const open = thread => {
            setSelection({ key: storageKey, teamId: thread.team.teamId });
            setError(null);
            markRead(thread.messages.filter(message => message.toTeamId === teamId).map(message => message.id));
        };
        React.useEffect(() => {
            if (compact || threadRequest?.key !== storageKey) return;
            const thread = threads.find(item => item.team.teamId === threadRequest.teamId);
            if (thread) open(thread);
        }, [storageKey, compact, threadRequest]);
        const newestId = active?.latest?.id;
        React.useEffect(() => {
            if (!compact && active && selectedId) {
                endRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
                const unseen = active.messages.filter(message => message.toTeamId === teamId && !read.includes(message.id));
                if (unseen.length) markRead(unseen.map(message => message.id));
            }
        }, [storageKey, selectedId, newestId, isTyping]);
        React.useEffect(() => {
            if (compact || !inboxRef.current || !window.document) return undefined;
            const inbox = inboxRef.current;
            let frame = null;
            const measure = () => {
                frame = null;
                if (!window.matchMedia?.('(max-width: 900px)').matches) { inbox.style.removeProperty('--tl-chat-available-height'); return; }
                const viewport = window.visualViewport;
                const viewportHeight = viewport?.height || window.innerHeight;
                const top = Math.max(0, inbox.getBoundingClientRect().top - (viewport?.offsetTop || 0));
                const navHeight = document.querySelector('.tl-mobile-nav')?.getBoundingClientRect().height || 70;
                // The measured nav includes its bottom safe-area padding. Actual
                // inbox position includes the league header and top safe area.
                const available = Math.max(96, Math.floor(viewportHeight - top - navHeight - 12));
                const value = `${available}px`;
                if (inbox.style.getPropertyValue('--tl-chat-available-height') !== value) inbox.style.setProperty('--tl-chat-available-height', value);
            };
            const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(measure); };
            schedule();
            window.addEventListener('resize', schedule);
            window.addEventListener('scroll', schedule, { passive: true });
            window.visualViewport?.addEventListener('resize', schedule);
            window.visualViewport?.addEventListener('scroll', schedule);
            const observer = window.ResizeObserver ? new window.ResizeObserver(schedule) : null;
            if (inbox.parentElement) observer?.observe(inbox.parentElement);
            return () => {
                if (frame !== null) window.cancelAnimationFrame(frame);
                window.removeEventListener('resize', schedule);
                window.removeEventListener('scroll', schedule);
                window.visualViewport?.removeEventListener('resize', schedule);
                window.visualViewport?.removeEventListener('scroll', schedule);
                observer?.disconnect();
            };
        }, [compact, storageKey]);
        const avatar = team => window.TimeLeagueHelmetIcon && window.App.TimeLeagueHelmet
            ? h(window.TimeLeagueHelmetIcon, { helmet: team.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(team.name), size: 38 })
            : h('span', { className: 'tl-chat-avatar', 'aria-hidden': true }, team.name.slice(0, 2));
        const patchDraft = patch => {
            // The desktop preview follows the latest owner until a conversation
            // starts. Pin its recipient before typing so incoming mail cannot
            // move the composer to another thread while a reply is in progress.
            if (!selectedId && active) setSelection({ key: storageKey, teamId: active.team.teamId });
            setDrafts(previous => ({ ...previous, [draftKey]: { ...draft, ...patch, messageId: '', replyToId: '' } }));
        };
        const send = async event => {
            event?.preventDefault?.();
            if (!onSend || pending || sendingRef.current || !active || !draft.text.trim()) return;
            const messageId = draft.messageId || window.crypto?.randomUUID?.() || `mail_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
            const replyToId = draft.messageId ? draft.replyToId : active.messages.find(message => message.toTeamId === teamId)?.id;
            const payload = { toTeamId: active.team.teamId, text: draft.text.trim(), tone: draft.tone, messageId, ...(Number.isInteger(throughWeek) ? { seenThroughWeek: throughWeek } : {}), ...(replyToId ? { replyToId } : {}) };
            setDrafts(previous => ({ ...previous, [draftKey]: { ...draft, messageId, replyToId } }));
            sendingRef.current = true;
            setSending(true); setError(null);
            try {
                const result = await onSend(payload);
                if (result === false) throw new Error('Message could not be sent. Your draft is saved here.');
                setDrafts(previous => ({ ...previous, [draftKey]: { text: '', tone: 'neutral', messageId: '' } }));
            } catch (err) { setError({ key: draftKey, text: err.message || 'Message could not be sent. Try again.' }); }
            finally { sendingRef.current = false; setSending(false); }
        };
        if (compact) return h('section', { className: 'tl-card tl-rival-mail is-compact', 'aria-label': 'Rival mail' },
            h('div', { className: 'tl-card-title' }, h('span', null, 'Rival mail'), unread ? h('small', null, `${unread} unread`) : null),
            h('div', { className: 'tl-rival-previews' }, threads.filter(thread => thread.latest).slice(0, 2).map(thread => h('button', {
                type: 'button', className: 'tl-rival-preview', key: thread.team.teamId, onClick: () => onOpenThread ? onOpenThread(thread.team.teamId) : onNavigate?.('messages'),
            }, avatar(thread.team), h('span', null, h('strong', null, thread.team.name), h('span', null, thread.latest.fromTeamId === teamId ? 'You: ' : '', thread.latest.text))))),
            !messages.length ? h('p', { className: 'tl-rival-intro' }, 'Send a good game, make a deal, or start a rivalry.') : null,
            onNavigate ? h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('messages') }, 'Open conversations') : null);
        return h('section', { ref: inboxRef, className: `tl-card tl-rival-mail tl-inbox${selectedId ? ' has-thread' : ''}`, 'aria-label': 'Rival conversations' },
            h('aside', { className: 'tl-inbox-owners', 'aria-label': 'League managers' },
                h('div', { className: 'tl-inbox-title' }, h('h2', null, 'Rival mail'), unread ? h('span', { className: 'tl-chat-unread' }, unread) : null),
                h('nav', { className: 'tl-inbox-list', 'aria-label': 'Conversations' }, threads.map(thread => {
                    const count = thread.messages.filter(message => message.toTeamId === teamId && !read.includes(message.id)).length;
                    const trades = tradesForConversation(league, teamId, thread.team.teamId, throughWeek);
                    const tradePreview = trades.find(row => row.trade.status === 'pending') || trades[0];
                    return h('button', { type: 'button', key: thread.team.teamId, className: `tl-inbox-owner${active === thread ? ' is-active' : ''}`, onClick: () => open(thread), 'aria-current': active === thread ? 'true' : undefined },
                        avatar(thread.team), h('span', { className: 'tl-inbox-owner-copy' }, h('strong', null, thread.team.name), h('span', null, tradePreview ? `Trade · ${tradePreview.status}` : thread.latest ? `${thread.latest.fromTeamId === teamId ? 'You: ' : ''}${thread.latest.text}` : 'Start a conversation')),
                        count ? h('span', { className: 'tl-chat-unread', 'aria-label': `${count} unread` }, count) : null);
                }))),
            active ? h('div', { className: 'tl-chat' },
                h('header', { className: 'tl-chat-header' },
                    h('button', { type: 'button', className: 'tl-chat-back', onClick: () => setSelection(null), 'aria-label': 'Back to conversations' }, '‹'),
                    avatar(active.team), h('div', { className: 'tl-chat-heading' }, h('h3', null, active.team.name), h('small', null, active.team.manager === 'ai' ? (R.voices[active.team.aiPersona] || R.voices.steward).label : 'League manager')),
                    active.relationship ? h('span', { className: `tl-chat-mood${active.relationship.heat > 2 ? ' is-heated' : ''}`, title: 'Your tone can change how this manager negotiates and competes for waivers.' }, active.relationship.label) : null),
                relationship ? h('div', { className: 'tl-relationship', role: 'meter', 'aria-label': `Your relationship with ${active.team.name}`,
                    'aria-valuemin': 0, 'aria-valuemax': 12, 'aria-valuenow': affinity,
                    'aria-valuetext': relationship.heat === 0 ? 'Neutral. Halfway between Hot rival and Friend.' : `${relationship.label}. ${Math.abs(relationship.heat)} of 6 toward ${relationship.heat > 0 ? 'Hot rival' : 'Friend'}.`,
                }, h('div', { className: 'tl-relationship-track', 'aria-hidden': true },
                    h('span', { className: 'tl-relationship-midpoint' }),
                    h('span', { className: 'tl-relationship-marker', style: { left: `${affinity / 12 * 100}%` } })),
                h('div', { className: 'tl-relationship-labels', 'aria-hidden': true }, h('span', null, 'Hot rival'), h('span', null, 'Neutral'), h('span', null, 'Friend'))) : null,
                h(ConversationTrades, { rows: activeTrades, otherName: active.team.name, onTrades, onNavigate }),
                h('div', { className: 'tl-chat-history', role: 'log', 'aria-label': `Conversation with ${active.team.name}`, 'aria-live': 'polite', 'aria-relevant': 'additions text' },
                    active.profile ? h('details', { className: 'tl-rival-profile' }, h('summary', null, `At the other desk · ${active.strategy?.label || 'Their approach'}`),
                        h('p', null, active.strategy?.reason), h('dl', null,
                            h('dt', null, 'Wants'), h('dd', null, active.profile.goal),
                            h('dt', null, 'Worries about'), h('dd', null, active.profile.fear),
                            h('dt', null, 'How they operate'), h('dd', null, active.profile.tell)), h('p', null, active.profile.principle)) : null,
                    !active.messages.length ? h('div', { className: 'tl-chat-empty' }, avatar(active.team), h('strong', null, `Say something to ${active.team.name}`), h('p', null, active.team.manager === 'ai' ? 'Keep it friendly or add a little fuel to the rivalry.' : 'Your conversation starts here.')) : null,
                    [...active.messages].reverse().map((message, index, rows) => h(React.Fragment, { key: message.id },
                        !index || rows[index - 1].week !== message.week ? h('div', { className: 'tl-chat-divider' }, `Week ${message.week}`) : null,
                        h('article', { className: `tl-chat-message${message.fromTeamId === teamId ? ' is-own' : ''}`, 'aria-label': message.fromTeamId === teamId ? 'You' : active.team.name },
                            h('div', { className: 'tl-chat-bubble' }, message.context ? h('small', { className: 'tl-chat-context' }, message.context) : null,
                                h('p', null, message.text), message.detail ? h('small', { className: 'tl-chat-detail' }, message.detail) : null,
                                message.tradeId && (onTrades || onNavigate) ? h('button', { type: 'button', className: 'tl-chat-trade', onClick: () => onTrades ? onTrades(message.tradeId) : onNavigate('trades') }, 'View trade →') : null),
                            message.kind === 'chat' ? h('small', { className: 'tl-chat-time' }, new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : null))),
                    isTyping ? h('div', { className: 'tl-chat-typing', role: 'status', 'aria-label': `${active.team.name} is typing` },
                        h('span', { className: 'tl-typing-dots', 'aria-hidden': true }, [0, 1, 2].map(dot => h('i', { key: dot, style: { animationDelay: `${dot * 160}ms` } }))),
                        h('small', null, `${active.team.name} is typing…`)) : null,
                    h('div', { ref: endRef })),
                onSend ? h('form', { className: 'tl-chat-compose', onSubmit: send },
                    h('div', { className: 'tl-chat-quick', 'aria-label': 'Suggested replies' }, suggestedReplies.map(reply => h('button', { type: 'button', key: reply.tone, disabled: pending, title: reply.text, onClick: () => patchDraft({ text: reply.text, tone: reply.tone }) }, reply.label)), h('button', { type: 'button', className: 'tl-chat-new-replies', disabled: pending, onClick: () => { if (!selectedId) setSelection({ key: storageKey, teamId: active.team.teamId }); setReplyVariants(previous => ({ ...previous, [draftKey]: (previous[draftKey] || 0) + 1 })); } }, 'New replies')),
                    h('label', { className: 'tl-chat-tone' }, 'Tone', h('select', { 'aria-label': 'Message tone', value: draft.tone, disabled: pending, onChange: event => patchDraft({ tone: event.target.value }) },
                        h('option', { value: 'neutral' }, 'Casual'), h('option', { value: 'friendly' }, 'Friendly'), h('option', { value: 'competitive' }, 'Competitive'), h('option', { value: 'dismissive' }, 'Dismissive'))),
                    h('div', { className: 'tl-chat-input-row' }, h('textarea', { 'aria-label': `Message ${active.team.name}`, placeholder: 'Message…', value: draft.text, rows: 2, maxLength: 500, disabled: pending,
                        onChange: event => patchDraft({ text: event.target.value }),
                        onKeyDown: event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) send(event); } }),
                        h('button', { className: 'tl-chat-send', type: 'submit', disabled: pending || !draft.text.trim(), 'aria-label': `Send message to ${active.team.name}` }, sending ? '…' : '↑')),
                    h('div', { className: 'tl-chat-compose-note' }, h('small', null, active.team.manager === 'ai' ? 'Tone shapes the rivalry. Scores stay on the field.' : isPrivate ? 'Only you and this manager can see these messages.' : 'Send a message to the other desk.'), h('small', null, `${draft.text.length}/500`)),
                    error?.key === draftKey ? h('p', { className: 'tl-chat-error', role: 'alert' }, error.text) : null) : h('p', { className: 'tl-chat-readonly' }, 'Open your own manager seat to send messages.'))
                : h('p', { className: 'tl-chat-empty' }, 'No other managers have joined this league yet.'));
    }
    window.WrTimeLeagueRivalsPanel = WrTimeLeagueRivalsPanel;
})();
