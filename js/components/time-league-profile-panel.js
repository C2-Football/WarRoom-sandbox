(function () {
    'use strict';
    const h = React.createElement;
    const Profile = window.App.TimeLeagueProfile;
    const Helmet = window.App.TimeLeagueHelmet;
    function WrTimeLeagueProfilePanel({ onSaved }) {
        const userId = window.App.OD?.getCurrentUserId?.() || null;
        const [snapshot, setSnapshot] = React.useState(() => ({ userId, profile: Profile.readLocal(), loading: true }));
        const [saving, setSaving] = React.useState(false);
        const [feedback, setFeedback] = React.useState(null);
        const [refresh, setRefresh] = React.useState(0);
        const saveInProgress = React.useRef(false);
        const matchingAccount = snapshot.userId === userId;
        const draft = matchingAccount ? snapshot.profile : Profile.readLocal();
        const loading = !matchingAccount || snapshot.loading;
        const frozen = loading || saving;
        React.useEffect(() => {
            let active = true;
            setSnapshot({ userId, profile: Profile.readLocal(), loading: true });
            setFeedback(null);
            Profile.get().then(result => {
                if (!active) return;
                setSnapshot({ userId, profile: result.profile || Profile.readLocal(), loading: false });
                if (!result.ok) setFeedback({ error: true, text: result.error });
            });
            return () => { active = false; };
        }, [userId, refresh]);
        const change = patch => {
            setSnapshot(previous => ({ userId, loading: false, profile: Profile.normalize({ ...(previous.userId === userId ? previous.profile : Profile.readLocal()), ...patch }) }));
            setFeedback(null);
        };
        const updateHelmet = helmet => change({ helmet });
        const changeColor = (key, color) => change({ [key]: color });
        const matchTeamColors = () => change({ helmet: { ...draft.helmet, artworkMode: 'team-colors', shellColor: draft.primaryColor, stripeColor: draft.secondaryColor } });
        const save = async event => {
            event.preventDefault();
            if (frozen || saveInProgress.current) return;
            saveInProgress.current = true;
            setSaving(true); setFeedback(null);
            try {
                const result = await Profile.save(draft);
                if ((window.App.OD?.getCurrentUserId?.() || null) !== userId) return;
                if (!result.ok) { setFeedback({ error: true, text: result.error }); return; }
                setSnapshot({ userId, profile: result.profile, loading: false });
                setFeedback({ text: result.storage === 'device' ? 'Team design saved on this device. New solo teams will wear it.' : result.profile.publicProfile ? 'Profile saved. Your team is visible in the Vault community.' : 'Profile saved to your account. Your team design is ready for your next league.' });
                onSaved?.(result.profile);
            } finally { saveInProgress.current = false; setSaving(false); }
        };
        const style = { '--tl-profile-primary': draft.primaryColor, '--tl-profile-secondary': draft.secondaryColor };
        const mark = Helmet.monogramFor(draft.teamName);
        return h('section', { className: 'tl-profile', style },
            h('header', { className: `tl-profile-banner tl-profile-backdrop-${draft.backdrop}` },
                h('div', { className: 'tl-profile-banner-copy' }, h('small', null, 'THE VAULT · YOUR TEAM IDENTITY'), h('h2', null, draft.teamName), h('p', null, draft.displayName),
                    h('div', { className: 'tl-profile-status' }, h('span', null, userId ? 'Account profile' : 'Device profile'), h('span', null, draft.publicProfile && userId ? 'Public profile' : 'Private profile'), draft.lookingForLeague && userId && h('span', null, 'Looking for a league'))),
                h('div', { className: 'tl-profile-banner-helmet' }, h(window.TimeLeagueHelmetIcon, { helmet: draft.helmet, letter: mark, size: 210, title: `${draft.teamName} helmet` }))),
            loading && h('p', { className: 'tl-profile-loading', role: 'status' }, 'Loading your team design…'),
            feedback && matchingAccount && h('div', { className: `tl-profile-feedback${feedback.error ? ' is-error' : ''}`, role: feedback.error ? 'alert' : 'status' }, feedback.text, feedback.error && h('button', { type: 'button', className: 'tl-btn', disabled: frozen, onClick: () => setRefresh(value => value + 1) }, 'Reload profile')),
            h('details', { className: 'tl-profile-customize', key: userId || 'device' },
                h('summary', null, h('span', null, 'Customize'), h('small', null, 'Names, team design & privacy')),
            h('form', { className: 'tl-profile-form', onSubmit: save },
                h('div', { className: 'tl-profile-heading' }, h('div', null, h('h3', null, 'Make it yours.'), h('p', null, 'Build the look you bring into every new league.')), h('small', null, userId ? 'SAVED TO YOUR ACCOUNT' : 'DEVICE PROFILE')),
                h('fieldset', { disabled: frozen, className: 'tl-profile-fields' },
                    h('div', { className: 'tl-profile-name-grid' },
                        h('label', { className: 'tl-field' }, h('span', null, 'Your display name'), h('input', { value: draft.displayName, maxLength: 40, required: true, autoComplete: 'nickname', onChange: event => {
                            const value = event.target.value;
                            setSnapshot(previous => ({ ...previous, profile: { ...previous.profile, displayName: value } })); setFeedback(null);
                        } })),
                        h('label', { className: 'tl-field' }, h('span', null, 'Your team name'), h('input', { value: draft.teamName, maxLength: 40, required: true, onChange: event => {
                            const value = event.target.value;
                            setSnapshot(previous => ({ ...previous, profile: { ...previous.profile, teamName: value } })); setFeedback(null);
                        } }))),
                    h('div', { className: 'tl-profile-design-row' },
                        h('div', { className: 'tl-profile-helmet-control' }, h(window.TimeLeagueHelmetPicker, { helmet: draft.helmet, name: draft.teamName, letter: mark, onChange: updateHelmet }), h('div', null, h('strong', null, 'Helmet artwork'), h('p', null, 'Choose a complete helmet illustration and its colors.'), h('button', { type: 'button', className: 'tl-btn', onClick: matchTeamColors }, 'Use team colors on helmet'))),
                        [['primaryColor', 'Primary color'], ['secondaryColor', 'Accent color']].map(([id, label]) => h('label', { key: id, className: 'tl-profile-color' }, h('span', null, label), h('div', null, h('input', { type: 'color', value: draft[id], 'aria-label': label, onChange: event => changeColor(id, event.target.value) }), h('b', null, draft[id]))))),
                    h('div', { className: 'tl-profile-backdrops' }, h('h4', null, 'Your backdrop'), h('div', { className: 'tl-profile-backdrop-options' }, Profile.BACKDROPS.map(item => h('button', { type: 'button', key: item.id, className: `tl-profile-backdrop-option tl-profile-backdrop-${item.id}${draft.backdrop === item.id ? ' selected' : ''}`, 'aria-pressed': draft.backdrop === item.id, onClick: () => change({ backdrop: item.id }) }, h('strong', null, item.label), h('small', null, item.detail), draft.backdrop === item.id && h('span', { 'aria-hidden': true }, '✓'))))),
                    h('div', { className: 'tl-profile-visibility' }, h('h4', null, 'Join the community'),
                        h('label', null, h('input', { type: 'checkbox', checked: Boolean(userId && draft.publicProfile), disabled: !userId, onChange: event => change({ publicProfile: event.target.checked, lookingForLeague: event.target.checked && draft.lookingForLeague }) }), h('span', null, h('strong', null, 'Show my profile in the Vault community'), h('small', null, 'Share your display name, team design and multiplayer results on the leaderboard.'))),
                        h('label', null, h('input', { type: 'checkbox', checked: Boolean(userId && draft.lookingForLeague), disabled: !userId || !draft.publicProfile, onChange: event => change({ lookingForLeague: event.target.checked }) }), h('span', null, h('strong', null, 'I’m looking for a league'), h('small', null, 'Let other managers find you and invite you to a league.'))),
                        !userId && h('p', null, 'Sign in to save across devices and join the community. Your guest design stays private.'))),
                h('footer', { className: 'tl-profile-save' }, h('p', null, 'Your saved design is the default for new teams. Existing league teams keep their own look.'), h('button', { type: 'submit', className: 'tl-btn primary', disabled: frozen || !draft.displayName.trim() || !draft.teamName.trim() }, saving ? 'Saving…' : 'Save profile')))));
    }
    window.WrTimeLeagueProfilePanel = WrTimeLeagueProfilePanel;
})();
