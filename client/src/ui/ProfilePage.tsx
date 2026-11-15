import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type CosmeticItem, type ProfileCustomization, type PublicProfile } from '../api';
import { currencyLabel } from '../currency';
import { CardArtwork } from './CardArtwork';

type ProfileData = Awaited<ReturnType<typeof api.profile>>;
type ProfileDraft = Pick<ProfileCustomization,
  'nickname' | 'nicknameColor' | 'description' | 'colorPrimary' | 'colorSecondary' | 'theme' |
  'avatarItemId' | 'bannerItemId' | 'avatarImagePath' | 'bannerImagePath' | 'speechText' |
  'frameItemId' | 'titleItemId' | 'featuredCardId'
>;

const cosmeticKinds: Array<{ kind: CosmeticItem['kind']; label: string; field: 'avatarItemId' | 'bannerItemId' | 'frameItemId' | 'titleItemId' }> = [
  { kind: 'avatar', label: 'Avatar', field: 'avatarItemId' },
  { kind: 'banner', label: 'Banner', field: 'bannerItemId' },
  { kind: 'frame', label: 'Moldura', field: 'frameItemId' },
  { kind: 'title', label: 'Título', field: 'titleItemId' }
];

const rankingMetrics = [
  { value: 'cards', label: 'Quantidade de cartas' },
  { value: 'gold', label: 'Moedas' },
  { value: 'level', label: 'Nível da conta' }
] as const;
type RankingMetric = typeof rankingMetrics[number]['value'];

function RankingMetricPicker({ value, onChange }: { value: RankingMetric; onChange: (value: RankingMetric) => void }) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const selectedMetric = rankingMetrics.find((item) => item.value === value)!;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (open) optionsRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }, [open]);

  function moveFocus(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const options = optionsRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    if (!options?.length) return;
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    options[(index + offset + options.length) % options.length]?.focus();
  }

  return <div className="ranking-metric-picker" ref={pickerRef}>
    <span className="ranking-metric-label">Ordenar por</span>
    <button
      ref={triggerRef}
      type="button"
      className="ranking-metric-trigger"
      aria-label={`Categoria do ranking: ${selectedMetric.label}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls="ranking-metric-options"
      onClick={() => setOpen((current) => !current)}
    >
      <span>{selectedMetric.label}</span>
    </button>
    {open && <div
      ref={optionsRef}
      className="ranking-metric-options"
      id="ranking-metric-options"
      role="listbox"
      aria-label="Categoria do ranking"
    >
      {rankingMetrics.map((item, index) => <button
        key={item.value}
        type="button"
        role="option"
        aria-selected={value === item.value}
        className={value === item.value ? 'selected' : ''}
        onKeyDown={(event) => moveFocus(event, index)}
        onClick={() => {
          onChange(item.value);
          setOpen(false);
          triggerRef.current?.focus();
        }}
      >
        <span>{item.label}</span>
        {value === item.value && <span className="ranking-metric-check" aria-hidden="true">✓</span>}
      </button>)}
    </div>}
  </div>;
}

export function ProfilePage({
  data,
  onRefresh,
  page
}: {
  data: ProfileData;
  onRefresh: () => Promise<void>;
  page: 'profile' | 'shop' | 'rankings';
}) {
  const { profile, cosmetics, cards, achievements } = data;
  const [draft, setDraft] = useState<ProfileDraft>(() => profileDraft(profile));
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState('');
  const [bannerPreviewUrl, setBannerPreviewUrl] = useState('');
  const [rankings, setRankings] = useState<Awaited<ReturnType<typeof api.rankings>>['rankings']>([]);
  const [publicProfile, setPublicProfile] = useState<PublicProfile | null>(null);
  const [metric, setMetric] = useState<'cards' | 'gold' | 'level'>('cards');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const publicProfileCloseRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => setDraft(profileDraft(profile)), [profile]);
  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);
  useEffect(() => {
    if (!bannerFile) {
      setBannerPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(bannerFile);
    setBannerPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [bannerFile]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!publicProfile) return;
    const closeButton = publicProfileCloseRef.current;
    closeButton?.focus();
    function handleModalKeys(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPublicProfile(null);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        closeButton?.focus();
      }
    }
    document.addEventListener('keydown', handleModalKeys);
    return () => {
      document.removeEventListener('keydown', handleModalKeys);
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [publicProfile]);
  useEffect(() => {
    if (page !== 'rankings') return;
    let active = true;
    void api.rankings(metric)
      .then((result) => { if (active) setRankings(result.rankings); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o ranking.');
      });
    return () => { active = false; };
  }, [metric, page]);
  useEffect(() => {
    if (page !== 'rankings') setPublicProfile(null);
  }, [page]);

  function update<K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const nextDraft = { ...draft };
      if (avatarFile) {
        nextDraft.avatarImagePath = (await api.uploadProfileImage(avatarFile, 'avatar')).imagePath;
      }
      if (bannerFile) {
        nextDraft.bannerImagePath = (await api.uploadProfileImage(bannerFile, 'banner')).imagePath;
      }
      await api.updateProfile(nextDraft);
      setDraft(nextDraft);
      setAvatarFile(null);
      setBannerFile(null);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
      if (bannerInputRef.current) bannerInputRef.current.value = '';
      await onRefresh();
      setNotice('Perfil atualizado.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o perfil.');
    } finally {
      setBusy(false);
    }
  }

  async function purchase(item: CosmeticItem) {
    setError('');
    setNotice('');
    setBusy(true);
    const storageKey = `rng.pendingCosmeticPurchase:${item.id}`;
    try {
      const saved = localStorage.getItem(storageKey);
      const idempotencyKey = saved ? JSON.parse(saved) as string : crypto.randomUUID();
      if (!saved) localStorage.setItem(storageKey, JSON.stringify(idempotencyKey));
      await api.purchaseCosmetic(item.id, idempotencyKey);
      localStorage.removeItem(storageKey);
      await onRefresh();
      setNotice(`${item.name} adicionado à sua coleção.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível comprar o item.');
    } finally {
      setBusy(false);
    }
  }

  async function openPublicProfile(nickname: string) {
    setError('');
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      const result = await api.publicProfile(nickname);
      returnFocusRef.current = trigger;
      setPublicProfile(result.profile);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar esse perfil.');
    }
  }

  const equippedIds = new Set([
    draft.avatarItemId, draft.bannerItemId, draft.frameItemId, draft.titleItemId
  ]);
  const featuredCard = cards.find((card) => card.card_id === draft.featuredCardId);
  const selectedAvatar = cosmetics.find((item) => item.id === draft.avatarItemId);
  const selectedBanner = cosmetics.find((item) => item.id === draft.bannerItemId);
  const selectedFrame = cosmetics.find((item) => item.id === draft.frameItemId);
  const selectedTitle = cosmetics.find((item) => item.id === draft.titleItemId);
  const avatarImage = avatarPreviewUrl || draft.avatarImagePath;
  const bannerImage = bannerPreviewUrl || draft.bannerImagePath;
  const bannerPrimary = selectedBanner?.previewPrimary ?? profile.banner?.colorPrimary ?? draft.colorPrimary;
  const bannerSecondary = selectedBanner?.previewSecondary ?? profile.banner?.colorSecondary ?? draft.colorSecondary;
  const avatarPrimary = selectedAvatar?.previewPrimary ?? profile.avatar?.colorPrimary ?? draft.colorPrimary;
  const avatarSecondary = selectedAvatar?.previewSecondary ?? profile.avatar?.colorSecondary ?? draft.colorSecondary;

  return (
    <section className="page-section profile-page">
      {page === 'profile' && <div className={`profile-hero${bannerImage ? ' has-banner-image' : ''}`} style={{
        backgroundColor: bannerPrimary,
        backgroundImage: bannerImage ? `linear-gradient(90deg, #0008, #0002), url("${bannerImage}")` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        borderBottom: `4px solid ${bannerSecondary}`
      }}>
        <div className="profile-avatar" style={{
          borderColor: selectedFrame?.previewPrimary ?? profile.frame?.colorPrimary ?? avatarSecondary,
          backgroundColor: avatarPrimary
        }}>
          {avatarImage
            ? <img src={avatarImage} alt={`Imagem de perfil de ${draft.nickname}`} />
            : selectedAvatar?.name.slice(0, 1) ?? profile.avatar?.name.slice(0, 1) ?? draft.nickname.slice(0, 1).toUpperCase()}
        </div>
        <div className="profile-hero-copy">
          <p className="eyebrow">PERFIL DO JOGADOR</p>
          <h2><span style={{ color: draft.nicknameColor }}>{draft.nickname}</span>{selectedTitle?.name || profile.title ? <small> · {selectedTitle?.name ?? profile.title}</small> : null}</h2>
          <p>{draft.description || 'Personalize seu perfil e destaque sua coleção.'}</p>
          {draft.speechText && <p className="profile-speech-bubble">{draft.speechText}</p>}
        </div>
        <div className="profile-level"><strong>Nível {profile.level}</strong><span>{profile.xp.toLocaleString('pt-BR')} XP</span></div>
      </div>}

      {error && <div className="message error dismissible-message" role="alert"><span>{error}</span><button type="button" aria-label="Fechar mensagem de erro" onClick={() => setError('')}><svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" /></svg></button></div>}
      {notice && <div className="toast-region"><div className="message success toast-message" role="status" aria-live="polite"><svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /><circle cx="12" cy="12" r="9" /></svg><span>{notice}</span><button type="button" aria-label="Fechar notificação" onClick={() => setNotice('')}><svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" /></svg></button></div></div>}

      {page === 'profile' && <>
      <div className="profile-stat-grid">
        <article><span>Sorteios</span><strong>{Number(profile.stats.total_draws).toLocaleString('pt-BR')}</strong></article>
        <article><span>Cartas únicas</span><strong>{profile.stats.unique_cards.toLocaleString('pt-BR')}</strong></article>
        <article><span>Conquistas</span><strong>{achievements.length.toLocaleString('pt-BR')}</strong></article>
      </div>
      <details className="profile-rarity-stats"><summary>Sorteios por raridade</summary>
        <div>{Object.entries(profile.stats.draws_by_rarity).length
          ? Object.entries(profile.stats.draws_by_rarity).map(([rarity, amount]) => <span key={rarity}>{rarity}: {amount}</span>)
          : <span className="muted">Ainda não há estatísticas por raridade.</span>}</div>
      </details>

      <form className="profile-editor" onSubmit={(event) => void saveProfile(event)}>
        <div className="section-heading"><div><p className="eyebrow">IDENTIDADE</p><h2>Personalizar perfil</h2></div></div>
        <div className="profile-form-grid">
          <label>Apelido<input required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]+" value={draft.nickname} onChange={(event) => update('nickname', event.target.value)} /></label>
          <label>Tema<select value={draft.theme} onChange={(event) => update('theme', event.target.value as ProfileDraft['theme'])}><option value="light">Claro</option><option value="dark">Escuro</option></select></label>
          <label className="profile-wide">Descrição<textarea maxLength={240} rows={3} value={draft.description} onChange={(event) => update('description', event.target.value)} /></label>
          <div className="profile-image-setting">
            <label htmlFor="profile-avatar-file">Imagem de perfil</label>
            <input ref={avatarInputRef} id="profile-avatar-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)} />
            <small>JPG, PNG, WebP ou GIF. A imagem aparece no avatar redondo.</small>
            {avatarImage && <div className="profile-image-preview avatar-image-preview"><img src={avatarImage} alt="Prévia da imagem de perfil" /></div>}
            <button type="button" className="quiet-button" disabled={!draft.avatarImagePath && !avatarFile} onClick={() => {
              setAvatarFile(null);
              if (avatarInputRef.current) avatarInputRef.current.value = '';
              update('avatarImagePath', null);
            }}>Remover imagem</button>
          </div>
          <div className="profile-image-setting">
            <label htmlFor="profile-banner-file">Imagem do banner</label>
            <input ref={bannerInputRef} id="profile-banner-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setBannerFile(event.target.files?.[0] ?? null)} />
            <small>JPG, PNG, WebP ou GIF. Use uma imagem horizontal para melhor resultado.</small>
            {bannerImage && <div className="profile-image-preview banner-image-preview"><img src={bannerImage} alt="Prévia do banner do perfil" /></div>}
            <button type="button" className="quiet-button" disabled={!draft.bannerImagePath && !bannerFile} onClick={() => {
              setBannerFile(null);
              if (bannerInputRef.current) bannerInputRef.current.value = '';
              update('bannerImagePath', null);
            }}>Remover banner</button>
          </div>
          <label className="profile-wide">Texto do balão de fala
            <textarea maxLength={120} rows={2} value={draft.speechText} onChange={(event) => update('speechText', event.target.value)} aria-describedby="profile-speech-count" placeholder="Escreva uma frase curta para aparecer ao lado do seu avatar" />
            <small id="profile-speech-count">{draft.speechText.length}/120 caracteres</small>
          </label>
          <label>Cor do nome<input type="color" value={draft.nicknameColor} onChange={(event) => update('nicknameColor', event.target.value)} /></label>
          {cosmeticKinds.map(({ kind, label, field }) => (
            <label key={kind}>{label}
              <select value={draft[field] ?? ''} onChange={(event) => update(field, event.target.value || null)}>
                <option value="">Padrão</option>
                {cosmetics.filter((item) => item.kind === kind && item.owned).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          ))}
          <label>Card em destaque
            <select value={draft.featuredCardId ?? ''} onChange={(event) => update('featuredCardId', event.target.value || null)}>
              <option value="">Nenhuma</option>
              {cards.map((card) => <option key={card.card_id} value={card.card_id}>{card.name} · {card.rarity_name}</option>)}
            </select>
          </label>
        </div>
        {featuredCard && <div className="profile-featured-preview"><CardArtwork className="profile-featured-artwork" imagePath={featuredCard.image_path} alt={featuredCard.name} /><span>Destaque atual: <strong>{featuredCard.name}</strong></span></div>}
        <button className="primary-button" type="submit" disabled={busy}>Salvar perfil</button>
      </form>
      </>}

      {page === 'shop' && <section className="profile-shop">
        <div className="section-heading"><div><p className="eyebrow">LOJA</p><h2>Itens de personalização</h2></div></div>
        <div className="cosmetic-grid">
          {cosmetics.map((item) => (
            <article className="cosmetic-card" key={item.id}>
              <div className="cosmetic-preview" style={{ backgroundColor: item.previewPrimary, borderBottom: `4px solid ${item.previewSecondary}` }}>
                {item.kind === 'title' ? <strong>{item.name}</strong> : <span aria-hidden="true">✦</span>}
              </div>
              <div className="cosmetic-copy"><strong>{item.name}</strong><small>{cosmeticKindLabel(item.kind)} · Nível {item.requiredLevel}+</small><p>{item.description}</p></div>
              <div className="cosmetic-action">
                <span>{item.priceAmount.toLocaleString('pt-BR')} {currencyLabel(item.priceCurrency, item.priceAmount)}</span>
                {item.owned
                  ? <span className="muted">{equippedIds.has(item.id) ? 'Equipado' : 'Adquirido'}</span>
                  : <button className="secondary-button" type="button" disabled={busy || !item.canPurchase} onClick={() => void purchase(item)}>
                    {item.canPurchase ? 'Comprar' : `Nível ${item.requiredLevel}${item.requiredAchievementKey ? ' + conquista' : ''}`}
                  </button>}
              </div>
            </article>
          ))}
          {!cosmetics.length && <div className="empty-panel"><p className="muted">A loja ainda não tem itens disponíveis.</p></div>}
        </div>
      </section>}

      {page === 'profile' && <section className="profile-achievements">
        <div className="section-heading"><div><p className="eyebrow">PROGRESSO</p><h2>Conquistas desbloqueadas</h2></div></div>
        {achievements.length
          ? <div className="achievement-list">{achievements.map((achievement) => (
            <article key={achievement.key}><strong>{achievement.name}</strong><p>{achievement.description}</p><small>{new Date(achievement.unlocked_at).toLocaleDateString('pt-BR')}</small></article>
          ))}</div>
          : <p className="muted">Suas conquistas aparecerão aqui.</p>}
      </section>}

      {page === 'rankings' && <section className="profile-rankings">
        <div className="section-heading"><div><p className="eyebrow">COMUNIDADE</p><h2>Ranking</h2></div>
          <RankingMetricPicker value={metric} onChange={setMetric} />
        </div>
        {rankings.length
          ? <ol className="ranking-list">{rankings.map((row) => <li key={`${row.rank}-${row.nickname}`}><button type="button" className="ranking-profile-button" onClick={() => void openPublicProfile(row.nickname)}>#{row.rank} · <span style={{ color: row.nicknameColor }}>{row.nickname}</span></button><span>
            {metric === 'cards'
              ? `${row.cards.toLocaleString('pt-BR')} cartas`
              : metric === 'gold'
                ? `${row.gold.toLocaleString('pt-BR')} ${currencyLabel('gold', row.gold)}`
                : `Nível ${row.level.toLocaleString('pt-BR')} · ${row.xp.toLocaleString('pt-BR')} XP`}
          </span></li>)}</ol>
          : <p className="muted">Ainda não há posições para exibir.</p>}
      </section>}

      {page === 'rankings' && publicProfile && <div className="public-profile-overlay" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setPublicProfile(null);
      }}>
        <section className={`public-profile-card theme-${publicProfile.theme}`} role="dialog" aria-modal="true" aria-labelledby="public-profile-title">
          <button ref={publicProfileCloseRef} type="button" className="quiet-button public-profile-close" onClick={() => setPublicProfile(null)}>Fechar</button>
          <div className={`public-profile-banner${publicProfile.bannerImagePath ? ' has-banner-image' : ''}`} style={{
            backgroundColor: publicProfile.banner?.colorPrimary ?? publicProfile.colorPrimary,
            backgroundImage: publicProfile.bannerImagePath
              ? `linear-gradient(90deg, #0008, #0002), url("${publicProfile.bannerImagePath}")`
              : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            borderBottom: `4px solid ${publicProfile.banner?.colorSecondary ?? publicProfile.colorSecondary}`
          }}>
            <div className="profile-avatar" style={{
              borderColor: publicProfile.frame?.colorPrimary ?? publicProfile.avatar?.colorSecondary ?? publicProfile.colorSecondary,
              backgroundColor: publicProfile.avatar?.colorPrimary ?? publicProfile.colorPrimary
            }}>{publicProfile.avatarImagePath
              ? <img src={publicProfile.avatarImagePath} alt={`Imagem de perfil de ${publicProfile.nickname}`} />
              : publicProfile.avatar?.name.slice(0, 1) ?? publicProfile.nickname.slice(0, 1).toUpperCase()}</div>
            <div><p className="eyebrow">NÍVEL {publicProfile.level}</p><h2 id="public-profile-title"><span style={{ color: publicProfile.nicknameColor }}>{publicProfile.nickname}</span>{publicProfile.title ? ` · ${publicProfile.title}` : ''}</h2><p>{publicProfile.description}</p>{publicProfile.speechText && <p className="profile-speech-bubble">{publicProfile.speechText}</p>}</div>
          </div>
          <div className="public-profile-stats"><span>{publicProfile.xp.toLocaleString('pt-BR')} XP</span><span>{publicProfile.stats.totalDraws.toLocaleString('pt-BR')} sorteios</span><span>{publicProfile.stats.uniqueCards.toLocaleString('pt-BR')} cartas únicas</span></div>
          {publicProfile.featuredCard && <div className="public-featured-card"><CardArtwork className="profile-featured-artwork" imagePath={publicProfile.featuredCard.imagePath} alt={publicProfile.featuredCard.name} /><span>Carta em destaque: <strong>{publicProfile.featuredCard.name}</strong></span></div>}
        </section>
      </div>}
    </section>
  );
}

function profileDraft(profile: ProfileCustomization): ProfileDraft {
  return {
    nickname: profile.nickname,
    nicknameColor: profile.nicknameColor,
    description: profile.description,
    colorPrimary: profile.colorPrimary,
    colorSecondary: profile.colorSecondary,
    theme: profile.theme,
    avatarImagePath: profile.avatarImagePath,
    bannerImagePath: profile.bannerImagePath,
    speechText: profile.speechText,
    avatarItemId: profile.avatarItemId,
    bannerItemId: profile.bannerItemId,
    frameItemId: profile.frameItemId,
    titleItemId: profile.titleItemId,
    featuredCardId: profile.featuredCardId
  };
}

function cosmeticKindLabel(kind: CosmeticItem['kind']): string {
  return ({ avatar: 'Avatar', banner: 'Banner', frame: 'Moldura', effect: 'Efeito', title: 'Título' })[kind];
}
