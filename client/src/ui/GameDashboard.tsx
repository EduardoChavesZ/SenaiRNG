import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type CatalogCard, type CollectionCard, type Currency, type DailyRewardClaim, type DailyRewardOptions, type DrawOutcome, type InvocationDrawResult, type User, type UserPreferences, type WalletTransaction } from '../api';
import { currencyLabel, localizeCurrencyText } from '../currency';
import { formatOdds } from '../odds';
import { AdminDashboard } from './AdminDashboard';
import { CardArtwork } from './CardArtwork';
import { InvocationPage } from './InvocationPage';
import { PrizeWheel, getWheelTargetRotation, type WheelSegment } from './PrizeWheel';
import { ProfilePage } from './ProfilePage';

type View = 'home' | 'daily' | 'draw' | 'profile' | 'shop' | 'rankings' | 'collection' | 'history' | 'wallet';
type Wallet = { balance: number; gold: number; gems: number; xp: number; lastDailyClaimAt: string | null };
type Probability = Awaited<ReturnType<typeof api.probabilities>>['cards'][number];
type PendingDraw = { key: string; quantity: number; bannerId: string };
const DAILY_WHEEL_SPIN_DURATION_MS = 4800;

const transactionLabels: Record<string, string> = {
  signup_bonus: 'Bônus de cadastro',
  daily_reward: 'Recompensa da roleta',
  daily_streak_bonus: 'Bônus de sequência',
  draw_cost: 'Sorteio',
  duplicate_conversion: 'Conversão de duplicata',
  cosmetic_purchase: 'Compra na loja',
  admin_grant: 'Concessão administrativa',
  admin_adjustment: 'Ajuste administrativo'
};
type IconName = View | 'admin' | 'gold' | 'gems' | 'xp' | 'menu' | 'close' | 'logout' | 'arrow' | 'gift' | 'calendar' | 'sparkle' | 'coins' | 'collapse' | 'expand';
const navigationItems: Array<{ id: View; label: string; icon: IconName }> = [
  { id: 'home', label: 'Início', icon: 'home' },
  { id: 'daily', label: 'Recompensa diária', icon: 'daily' },
  { id: 'draw', label: 'Invocação', icon: 'draw' },
  { id: 'profile', label: 'Perfil', icon: 'profile' },
  { id: 'shop', label: 'Loja', icon: 'shop' },
  { id: 'rankings', label: 'Ranking', icon: 'rankings' },
  { id: 'collection', label: 'Coleção', icon: 'collection' },
  { id: 'history', label: 'Histórico', icon: 'history' },
  { id: 'wallet', label: 'Carteira', icon: 'wallet' }
];
const transactionIcons: Record<string, IconName> = {
  signup_bonus: 'gift',
  daily_reward: 'gift',
  daily_streak_bonus: 'calendar',
  draw_cost: 'sparkle',
  duplicate_conversion: 'coins',
  cosmetic_purchase: 'collection',
  admin_grant: 'wallet',
  admin_adjustment: 'wallet'
};
const currencyLabels: Record<Currency, string> = {
  gold: currencyLabel('gold'),
  gems: currencyLabel('gems'),
  xp: currencyLabel('xp'),
};
const viewTitles: Record<View, string> = {
  home: 'Visão geral',
  daily: 'Roleta de recompensas',
  draw: 'Invocação',
  profile: 'Meu perfil',
  shop: 'Loja de personalização',
  rankings: 'Ranking',
  collection: 'Coleção',
  history: 'Histórico',
  wallet: 'Carteira'
};
const iconPaths: Record<IconName, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v12h14V9M9 21v-7h6v7" /></>,
  daily: <><path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z" /><path d="M12 7V4m0 7 2 2m-2-2-2 2M7 3h10v4H7z" /></>,
  draw: <><path d="m12 3 2.1 5.9L20 11l-5.9 2.1L12 19l-2.1-5.9L4 11l5.9-2.1L12 3Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  shop: <><path d="M5 8h14l1 13H4L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
  rankings: <><path d="M8 21h8m-4-4v4M7 4h10v6a5 5 0 0 1-10 0V4Z" /><path d="M7 6H4v2a4 4 0 0 0 4 4m9-6h3v2a4 4 0 0 1-4 4" /></>,
  collection: <><rect x="4" y="3" width="13" height="16" rx="2" /><path d="M8 7h5m-5 4h5m-5 4h3m8-9v14a2 2 0 0 1-2 2H7" /></>,
  history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2M3 4v5h5" /></>,
  wallet: <><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v16H6.5A2.5 2.5 0 0 1 4 17.5v-11Z" /><path d="M4 7h16m-5 6h5m-5 0a1 1 0 1 0 0 .01" /></>,
  admin: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
  gold: <><circle cx="12" cy="12" r="9" /><path d="M15 8.5c-.6-.7-1.6-1-3-1-1.7 0-3 .8-3 2s1.3 2 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.4-.3-3-1m3-8v10" /></>,
  gems: <><path d="m6 3-4 6 10 12L22 9l-4-6H6Z" /><path d="M2 9h20M6 3l2 6 4 12 4-12 2-6" /></>,
  xp: <><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  close: <><path d="m18 6-12 12M6 6l12 12" /></>,
  logout: <><path d="M10 17l5-5-5-5m5 5H3" /><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" /></>,
  arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
  gift: <><path d="M20 12v10H4V12m-2-5h20v5H2zm10 0v15M12 7H7.5a2.5 2.5 0 1 1 2.4-3.2L12 7Zm0 0h4.5a2.5 2.5 0 1 0-2.4-3.2L12 7Z" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18m-13 4h2m4 0h2m-8 4h2" /></>,
  sparkle: <><path d="m12 3 2.1 5.9L20 11l-5.9 2.1L12 19l-2.1-5.9L4 11l5.9-2.1L12 3Z" /></>,
  coins: <><ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v5c0 1.7 2.7 3 6 3 1.1 0 2.1-.2 3-.4M3 12v5c0 1.7 2.7 3 6 3 1.4 0 2.7-.3 3.8-.8" /><path d="M15 11c-2.2 0-4 1.1-4 2.5S12.8 16 15 16s4-1.1 4-2.5-1.8-2.5-4-2.5Zm-4 2.5v5c0 1.4 1.8 2.5 4 2.5s4-1.1 4-2.5v-5" /></>,
  collapse: <><path d="m15 18-6-6 6-6" /><path d="M4 4v16" /></>,
  expand: <><path d="m9 18 6-6-6-6" /><path d="M20 4v16" /></>
};

export function GameDashboard({
  user,
  onLogout,
  logoutBusy,
  logoutError
}: {
  user: User;
  onLogout: () => void;
  logoutBusy: boolean;
  logoutError: string;
}) {
  const [view, setView] = useState<View>('home');
  const [dailyWheelRotation, setDailyWheelRotation] = useState(0);
  const [drawStatus, setDrawStatus] = useState<'idle' | 'waiting'>('idle');
  const [dailyWheelStatus, setDailyWheelStatus] = useState<'idle' | 'waiting' | 'spinning'>('idle');
  const [adminOpen, setAdminOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [catalog, setCatalog] = useState<CatalogCard[]>([]);
  const [rarities, setRarities] = useState<Array<{ id: string; name: string; active: boolean; deleted_at: string | null }>>([]);
  const [collection, setCollection] = useState<CollectionCard[]>([]);
  const [history, setHistory] = useState<DrawOutcome[]>([]);
  const [probabilities, setProbabilities] = useState<Probability[]>([]);
  const [dailyOptions, setDailyOptions] = useState<DailyRewardOptions | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [serverClockOffset, setServerClockOffset] = useState(0);
  const [profileData, setProfileData] = useState<Awaited<ReturnType<typeof api.profile>> | null>(null);
  const [latest, setLatest] = useState<InvocationDrawResult | null>(null);
  const [dailyResult, setDailyResult] = useState<DailyRewardClaim | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  const [filterName, setFilterName] = useState('');
  const [filterRarity, setFilterRarity] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [sort, setSort] = useState<'rarity' | 'name' | 'quantity'>('rarity');
  const [historyRarity, setHistoryRarity] = useState('');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [volume, setVolume] = useState(0.2);
  const [reduceEffects, setReduceEffects] = useState(false);
  const [invocationMusicEnabled, setInvocationMusicEnabled] = useState(false);
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const audioContext = useRef<AudioContext | null>(null);
  const pendingRecoveryStarted = useRef(false);

  const refresh = useCallback(async () => {
    const [walletData, ledgerData, catalogData, rarityData, collectionData, historyData, probabilityData, dailyRewardData, profile] = await Promise.all([
      api.wallet(), api.transactions(), api.catalog(), api.rarityCatalog(), api.collection(),
      api.history('?limit=50'), api.probabilities(),
      api.dailyRewardOptions(), api.profile()
    ]);
    setWallet(walletData);
    setTransactions(ledgerData.transactions);
    setCatalog(catalogData.cards);
    setRarities(rarityData.rarities);
    setCollection(collectionData.cards);
    setHistory(historyData.draws);
    setProbabilities(probabilityData.cards);
    setDailyOptions(dailyRewardData);
    setServerClockOffset(Date.parse(dailyRewardData.serverNow) - Date.now());
    setProfileData(profile);
    setReduceEffects(profile.preferences.reduceEffects);
    setInvocationMusicEnabled(profile.preferences.invocationMusicEnabled);
    setVolume(profile.preferences.soundVolume);
  }, []);

  useEffect(() => {
    void refresh()
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Não foi possível carregar sua conta.'))
      .finally(() => setLoading(false));
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    setSystemReducedMotion(preference.matches);
    const updatePreference = (event: MediaQueryListEvent) => setSystemReducedMotion(event.matches);
    preference.addEventListener('change', updatePreference);
    return () => preference.removeEventListener('change', updatePreference);
  }, [refresh]);

  useEffect(() => {
    if (view !== 'daily') return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [view]);

  useEffect(() => {
    if (!latest || revealedCount >= latest.draws.length || reduceEffects || systemReducedMotion) return;
    const timer = window.setTimeout(() => {
      setRevealedCount((current) => Math.min(current + 1, latest.draws.length));
    }, revealedCount === 0 ? 120 : 720);
    return () => window.clearTimeout(timer);
  }, [latest, revealedCount, reduceEffects, systemReducedMotion]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const rarityOptions = useMemo(() => [...new Map([
    ...rarities.map((rarity) => [rarity.id, { id: rarity.id, name: rarity.name }] as const),
    ...catalog.map((card) => [card.rarity_id, { id: card.rarity_id, name: card.rarity_name }] as const),
    ...history.map((item) => [item.rarity_id, { id: item.rarity_id, name: item.rarity_name }] as const)
  ]).values()], [rarities, catalog, history]);
  const rarityNames = rarityOptions.map((item) => item.name);
  const categoryNames = useMemo(() => [...new Set(catalog.map((card) => card.category_name).filter((name): name is string => Boolean(name)))], [catalog]);
  const collectionById = useMemo(() => new Map(collection.map((card) => [card.card_id, card])), [collection]);
  const collectionCatalog = useMemo(() => {
    const cardsById = new Map(catalog.map((card) => [card.id, card]));
    for (const ownedCard of collection) {
      if (!cardsById.has(ownedCard.card_id)) cardsById.set(ownedCard.card_id, ownedCard);
    }
    return [...cardsById.values()];
  }, [catalog, collection]);
  const probabilityById = useMemo(() => new Map(probabilities.map((item) => [item.id, item])), [probabilities]);
  const visibleCollection = useMemo(() => {
    const filtered = collectionCatalog.filter((card) =>
      card.name.toLowerCase().includes(filterName.toLowerCase())
      && (!filterRarity || card.rarity_name === filterRarity)
      && (!filterCategory || card.category_name === filterCategory)
    );
    return filtered.sort((left, right) => {
      if (sort === 'name') return left.name.localeCompare(right.name, 'pt-BR');
      if (sort === 'quantity') return (collectionById.get(right.id)?.quantity ?? 0) - (collectionById.get(left.id)?.quantity ?? 0);
      return right.rarity_sort_order - left.rarity_sort_order || left.name.localeCompare(right.name, 'pt-BR');
    });
  }, [collectionCatalog, collectionById, filterCategory, filterName, filterRarity, sort]);
  const recent = history.slice(0, 5);
  const rareHighlights = [...catalog].sort((a, b) => b.animation_level - a.animation_level).slice(0, 3);
  const nextDailySpinAt = dailyOptions ? Date.parse(dailyOptions.nextAvailableAt) : 0;
  const dailySpinRemainingMs = Math.max(0, nextDailySpinAt - (clockNow + serverClockOffset));
  const dailyCanSpin = user.role === 'admin'
    || Boolean(dailyOptions?.canClaim)
    || dailySpinRemainingMs === 0;
  async function claimDailyReward() {
    setError('');
    setNotice('');
    setBusy(true);
    setDailyWheelStatus('waiting');
    try {
      const saved = localStorage.getItem('rng.pendingDailyReward');
      const idempotencyKey = saved ? JSON.parse(saved) as string : crypto.randomUUID();
      if (!saved) localStorage.setItem('rng.pendingDailyReward', JSON.stringify(idempotencyKey));
      const claim = await api.claimDailyReward(idempotencyKey);
      localStorage.removeItem('rng.pendingDailyReward');
      const segments: WheelSegment[] = (dailyOptions?.rewards ?? []).map((reward) => ({
        id: reward.id,
        name: reward.name,
        effectiveCardChance: reward.effectiveChance,
        effectiveCardNumerator: reward.chanceNumerator,
        effectiveCardDenominator: reward.chanceDenominator,
        colorPrimary: reward.colorPrimary,
        colorSecondary: reward.colorSecondary
      }));
      if (claim.reward.id && segments.length) {
        const targetRotation = getWheelTargetRotation(dailyWheelRotation, segments, claim.reward.id);
        const duration = reduceEffects || systemReducedMotion ? 0 : DAILY_WHEEL_SPIN_DURATION_MS;
        setDailyWheelStatus('spinning');
        setDailyWheelRotation(targetRotation);
        if (duration > 0) await new Promise((resolve) => window.setTimeout(resolve, duration));
      }
      setDailyResult(claim);
      await refresh();
      const bonus = claim.milestone
        ? ` e ${claim.milestone.amount} ${currencyLabel(claim.milestone.currency ?? 'gold', claim.milestone.amount)} pelo marco de sequência`
        : '';
      setNotice(claim.idempotentReplay
        ? 'Resultado anterior recuperado; nenhuma recompensa foi concedida novamente.'
        : `Você recebeu ${claim.reward.amount} ${currencyLabel(claim.reward.currency, claim.reward.amount)}${bonus}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível resgatar a recompensa.');
    } finally {
      setDailyWheelStatus('idle');
      setBusy(false);
    }
  }

  async function draw(bannerId: string, quantity: number) {
    setError('');
    setNotice('');
    setBusy(true);
    setDrawStatus('waiting');
    try {
      const saved = localStorage.getItem('rng.pendingDraw');
      const pending = saved ? parsePendingDraw(saved) : null;
      if (pending && (pending.quantity !== quantity || pending.bannerId !== bannerId)) {
        throw new Error(`Há uma solicitação pendente para o banner ${pending.bannerId} em ${pending.quantity}x. Selecione esse banner e repita a quantidade para recuperar o resultado.`);
      }
      const idempotencyKey = pending?.key ?? crypto.randomUUID();
      if (!pending) localStorage.setItem('rng.pendingDraw', JSON.stringify({ key: idempotencyKey, quantity, bannerId }));
      const result = await api.draw(bannerId, quantity, idempotencyKey);
      localStorage.removeItem('rng.pendingDraw');
      setLatest(result);
      setRevealedCount(reduceEffects || systemReducedMotion ? result.draws.length : 0);
      setView('draw');
      setWallet((current) => current ? {
        ...current,
        balance: result.wallet.gold,
        gold: result.wallet.gold,
        gems: result.wallet.gems,
        xp: result.wallet.xp
      } : current);
      await refresh();
      if (result.idempotentReplay) setNotice('Resultado anterior recuperado; nenhuma nova cobrança foi feita.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível realizar o sorteio.');
    } finally {
      setDrawStatus('idle');
      setBusy(false);
    }
  }

  useEffect(() => {
    if (loading || pendingRecoveryStarted.current) return;
    const saved = localStorage.getItem('rng.pendingDraw');
    if (!saved) return;
    pendingRecoveryStarted.current = true;
    try {
      const pending = parsePendingDraw(saved);
      void draw(pending.bannerId, pending.quantity);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível recuperar a invocação pendente.');
    }
  }, [loading]);

  async function applyHistoryFilters() {
    const query = new URLSearchParams();
    if (historyRarity) query.set('rarityId', historyRarity);
    if (historyFrom) query.set('from', new Date(historyFrom).toISOString());
    if (historyTo) query.set('to', new Date(historyTo).toISOString());
    query.set('limit', '100');
    setError('');
    try {
      const result = await api.history(`?${query.toString()}`);
      setHistory(result.draws);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o histórico.');
    }
  }

  async function clearHistoryFilters() {
    setHistoryRarity('');
    setHistoryFrom('');
    setHistoryTo('');
    setError('');
    try {
      const result = await api.history('?limit=100');
      setHistory(result.draws);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o histórico.');
    }
  }

  function toggleSound() {
    if (soundEnabled) {
      setSoundEnabled(false);
      return;
    }
    const Context = window.AudioContext;
    if (Context) {
      audioContext.current ??= new Context();
      void audioContext.current.resume();
      setSoundEnabled(true);
    }
  }

  async function savePreferences(preferences: Partial<UserPreferences>) {
    setError('');
    try {
      await api.updatePreferences(preferences);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar suas preferências.');
    }
  }

  function playRevealSound(_color?: string) {
    const context = audioContext.current;
    if (!context || !soundEnabled || volume <= 0) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(880, context.currentTime + 0.1);
    gain.gain.setValueAtTime(volume * 0.13, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
  }

  if (loading) return <main className="loading">Carregando...</main>;
  if (adminOpen) return <AdminDashboard adminEmail={user.email} onClose={() => setAdminOpen(false)} />;

  return (
    <main className={`app-frame${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className={`game-sidebar${sidebarOpen ? ' mobile-open' : ''}`}>
        <div className="sidebar-top">
          <a className="sidebar-brand" href="#inicio" onClick={(event) => { event.preventDefault(); setView('home'); setSidebarOpen(false); }}>
            <span>SORTE</span><strong>SENAI</strong>
          </a>
          <button
            className="sidebar-toggle desktop-sidebar-toggle"
            type="button"
            aria-label={sidebarCollapsed ? 'Expandir navegação' : 'Recolher navegação'}
            aria-pressed={sidebarCollapsed}
            title={sidebarCollapsed ? 'Expandir navegação' : 'Recolher navegação'}
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            <Icon name={sidebarCollapsed ? 'expand' : 'collapse'} />
          </button>
          <button
            className="sidebar-toggle mobile-sidebar-toggle"
            type="button"
            aria-label={sidebarOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-controls="game-navigation"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((current) => !current)}
          >
            <Icon name={sidebarOpen ? 'close' : 'menu'} />
          </button>
        </div>
        <div className="sidebar-navigation" id="game-navigation">
          <p className="sidebar-label">JORNADA</p>
          <nav className="sidebar-nav" aria-label="Navegação principal">
            {navigationItems.map(({ id, label, icon }) => (
              <button key={id} type="button" aria-current={view === id ? 'page' : undefined} className={view === id ? 'active' : ''} onClick={() => { setView(id); setSidebarOpen(false); }}>
                <Icon name={icon} /><span className="nav-label">{label}</span>
              </button>
            ))}
          </nav>
          {user.role === 'admin' && <div className="sidebar-admin-group">
            <p className="sidebar-label">GESTÃO</p>
            <nav aria-label="Navegação administrativa">
              <button type="button" className="sidebar-admin-link" onClick={() => { setAdminOpen(true); setSidebarOpen(false); }}>
                <Icon name="admin" /><span className="nav-label">Administração</span>
              </button>
            </nav>
          </div>}
        </div>
        <div className="sidebar-account">
          <button type="button" className="sidebar-profile" onClick={() => { setView('profile'); setSidebarOpen(false); }} aria-label={`Abrir perfil de ${user.email}`}>
            <span className="sidebar-avatar" aria-hidden="true">{user.email.slice(0, 1).toUpperCase()}</span>
            <span className="sidebar-profile-copy"><strong style={{ color: profileData?.profile.nicknameColor }}>{profileData?.profile.nickname || 'Meu perfil'}</strong><small title={user.email}>{user.email}</small></span>
            <Icon name="arrow" />
          </button>
        </div>
      </aside>

      <div className="app-content">
        <header className="content-topbar">
          <div>
            <p className="eyebrow">{view === 'home' ? 'SUA JORNADA' : 'ÁREA DO JOGADOR'}</p>
            <h1>{viewTitles[view]}</h1>
          </div>
          <div className="topbar-actions">
            <div className="topbar-wallet" aria-label="Saldos atuais">
              <CurrencyBalance currency="gold" amount={wallet?.gold ?? null} variant="topbar" />
              <CurrencyBalance currency="gems" amount={wallet?.gems ?? null} variant="topbar" />
            </div>
            <button className="topbar-profile" type="button" onClick={() => setView('profile')} aria-label="Abrir seu perfil">
              <span className="topbar-avatar" aria-hidden="true">{user.email.slice(0, 1).toUpperCase()}</span>
              <span className="topbar-profile-copy"><small>Perfil</small><strong style={{ color: profileData?.profile.nicknameColor }}>{profileData?.profile.nickname || user.email.split('@')[0]}</strong></span>
            </button>
            <button className="logout-button" type="button" disabled={logoutBusy} onClick={onLogout} aria-label={logoutBusy ? 'Saindo da conta' : 'Sair da conta'}>
              <Icon name="logout" /><span>{logoutBusy ? 'Saindo...' : 'Sair'}</span>
            </button>
          </div>
        </header>

      {logoutError && <p className="message error page-message" role="alert">{logoutError}</p>}
      {error && <div className="message error page-message dismissible-message" role="alert"><span>{error}</span><button type="button" aria-label="Fechar mensagem de erro" onClick={() => setError('')}><Icon name="close" /></button></div>}
      {notice && <div className="toast-region"><div className="message success toast-message" role="status" aria-live="polite"><Icon name="gift" /><span>{notice}</span><button type="button" aria-label="Fechar notificação" onClick={() => setNotice('')}><Icon name="close" /></button></div></div>}

      {view === 'home' && (
        <>
          <section className="welcome-panel">
            <div className="welcome-copy">
              <p className="eyebrow">SEU ESPAÇO DE JOGO</p>
              <h2>Bem-vindo, <span style={{ color: profileData?.profile.nicknameColor }}>{profileData?.profile.nickname || user.email.split('@')[0]}</span>.</h2>
              <p>Acompanhe sua coleção e seus saldos. A recompensa diária é independente das invocações.</p>
              <div className="welcome-actions">
                <button className="primary-button" type="button" onClick={() => setView('draw')}><Icon name="draw" />Explorar invocações</button>
                <button className="secondary-button" type="button" onClick={() => setView('daily')}><Icon name="daily" />Recompensa diária</button>
              </div>
            </div>
            <div className="welcome-progress">
              <div className="welcome-progress-heading"><span>SEU PROGRESSO</span><strong>Nível {profileData?.profile.level ?? '—'}</strong></div>
              <div className="welcome-progress-stats">
                <div><small>Cartas únicas</small><strong>{profileData?.profile.stats.unique_cards.toLocaleString('pt-BR') ?? '—'}</strong></div>
                <div><small>Invocações</small><strong>{profileData ? Number(profileData.profile.stats.total_draws).toLocaleString('pt-BR') : '—'}</strong></div>
              </div>
            </div>
          </section>
          <section className="content-grid home-grid">
            <div className="home-main-column">
              <section className="home-panel home-cards-panel">
                <div className="home-panel-heading"><SectionHeading eyebrow="EM DESTAQUE" title="Cartas disponíveis" /><span className="home-count">{catalog.length}</span></div>
                {rareHighlights.length === 0
                  ? <DashboardEmpty icon="collection" title="Nenhuma carta em destaque" description="As cartas disponíveis aparecerão aqui quando houver itens no catálogo." action="Ver coleção" onAction={() => setView('collection')} />
                  : <div className="mini-card-grid home-card-grid">{rareHighlights.map((card) => <CardTile key={card.id} card={card} owned={collectionById.get(card.id)?.quantity ?? 0} probability={probabilityFor(probabilityById.get(card.id))} compact />)}</div>}
              </section>
              <section className="home-panel home-recent-panel">
                <div className="home-panel-heading"><SectionHeading eyebrow="RECENTES" title="Últimas invocações" /><button className="text-link" type="button" onClick={() => setView('history')}>Ver histórico <Icon name="arrow" /></button></div>
                {recent.length === 0
                  ? <DashboardEmpty icon="history" title="Nenhuma invocação ainda" description="Seus resultados aparecerão aqui depois da primeira invocação." action="Abrir histórico" onAction={() => setView('history')} />
                  : <div className="home-recent-list">{recent.map((drawItem) => <RecentDrawItem key={drawItem.id} item={drawItem} />)}</div>}
              </section>
            </div>
            <aside className="home-sidebar-column">
              <section className="home-panel home-wallet-panel">
                <div className="home-panel-heading"><SectionHeading eyebrow="SUA CARTEIRA" title="Saldos" /><button className="text-link" type="button" onClick={() => setView('wallet')}>Ver carteira <Icon name="arrow" /></button></div>
                <div className="home-currency-list">
                  <CurrencyBalance currency="gold" amount={wallet?.gold ?? null} variant="home" />
                  <CurrencyBalance currency="gems" amount={wallet?.gems ?? null} variant="home" />
                  <CurrencyBalance currency="xp" amount={wallet?.xp ?? null} variant="home" />
                </div>
              </section>
              <section className="home-panel home-ledger-panel">
                <div className="home-panel-heading"><SectionHeading eyebrow="ATIVIDADE DA CONTA" title="Movimentações recentes" /><button className="text-link" type="button" onClick={() => setView('wallet')}>Extrato completo <Icon name="arrow" /></button></div>
                <TransactionList transactions={transactions.slice(0, 5)} />
              </section>
            </aside>
          </section>
        </>
      )}

      {view === 'daily' && dailyOptions && (
        <section className="page-section daily-page">
          <div className="daily-summary-grid">
            <article><span>Sequência atual</span><strong>{formatDays(dailyOptions.currentStreak)}</strong></article>
            <article><span>Melhor sequência</span><strong>{formatDays(dailyOptions.bestStreak)}</strong></article>
            <article><span>Nível atual</span><strong>{dailyOptions.level}</strong></article>
          </div>
          <div className="wheel-layout">
            <aside className="wheel-options" aria-label="Possíveis recompensas">
              <div className="wheel-options-heading">
                <div><p className="eyebrow">POSSÍVEIS RECOMPENSAS</p></div>
                <span>{dailyOptions.rewards.length}</span>
              </div>
              {dailyOptions.rewards.map((reward) => {
                const odds = formatOdds(reward.chanceNumerator, reward.chanceDenominator, reward.effectiveChance);
                return <div className="wheel-option" key={reward.id}>
                  <span className="wheel-option-swatch" style={{ backgroundColor: reward.colorPrimary, borderColor: reward.colorSecondary }} />
                  <span className="wheel-option-name"><strong>{reward.name}</strong><small>{reward.amount} {currencyLabel(reward.currency, reward.amount)}</small></span>
                  <strong className="wheel-option-chance" title={odds.percent}>{odds.percent}</strong>
                </div>;
              })}
            </aside>
            <section className="wheel-panel" aria-label="Roleta de recompensas">
              <div className="wheel-panel-heading">
                <div><p className="eyebrow">ROLETA DE RECOMPENSAS</p><h2>{dailyCanSpin ? 'Gire para receber' : 'Próximo giro em breve'}</h2></div>
                <span className="wheel-cost">{user.role === 'admin' ? 'Giros livres para administradores' : '1 giro liberado a cada hora'}</span>
              </div>
              <div className="wheel-stage">
                <PrizeWheel
                  segments={dailyOptions.rewards.map((reward) => ({
                    id: reward.id,
                    name: reward.name,
                    effectiveCardChance: reward.effectiveChance,
                    effectiveCardNumerator: reward.chanceNumerator,
                    effectiveCardDenominator: reward.chanceDenominator,
                    colorPrimary: reward.colorPrimary,
                    colorSecondary: reward.colorSecondary
                  }))}
                  rotation={dailyWheelRotation}
                  duration={reduceEffects || systemReducedMotion ? 0 : DAILY_WHEEL_SPIN_DURATION_MS}
                  spinning={dailyWheelStatus === 'spinning'}
                  disabled={busy || !dailyCanSpin || dailyOptions.rewards.length === 0}
                  onSpin={() => void claimDailyReward()}
                  ariaLabel={`Roleta de recompensas com ${dailyOptions.rewards.length} opções`}
                  buttonLabel="Girar e receber uma recompensa"
                  centerLabel="GIRAR"
                />
              </div>
              <p className="wheel-status" role="status">
                {dailyWheelStatus === 'waiting'
                  ? 'Confirmando a recompensa com o servidor…'
                  : dailyWheelStatus === 'spinning'
                    ? 'A roleta está girando até a recompensa sorteada.'
                    : dailyResult
                      ? 'Recompensa definida pelo servidor.'
                      : 'Gire para receber uma recompensa.'}
              </p>
              <p className="wheel-countdown">
                {user.role === 'admin'
                  ? 'Giros ilimitados para administradores.'
                  : dailyCanSpin
                    ? 'Próximo giro disponível agora.'
                    : <>Próximo giro em <time dateTime={new Date(nextDailySpinAt).toISOString()}>{formatCountdown(dailySpinRemainingMs)}</time></>}
              </p>
              {dailyResult && <div className="daily-result-card">
                <strong>{dailyResult.reward.name}: +{dailyResult.reward.amount} {currencyLabel(dailyResult.reward.currency, dailyResult.reward.amount)}</strong>
                <span>Sequência: {formatDays(dailyResult.streakDays)}</span>
                {dailyResult.milestone && <span>Bônus de marco: {dailyResult.milestone.name} · +{dailyResult.milestone.amount} {currencyLabel(dailyResult.milestone.currency ?? 'gold', dailyResult.milestone.amount)}</span>}
              </div>}
            </section>
          </div>
          <section className="daily-history">
            <SectionHeading eyebrow="ÚLTIMOS RESGATES" title="Histórico de recompensas" />
            {dailyOptions.history.length === 0 ? <Empty text="Seu primeiro resgate aparecerá aqui." /> : <div className="admin-list">{dailyOptions.history.slice(0, 10).map((claim) => (
              <div className="admin-list-row" key={claim.id}>
                <div><strong>{localizeCurrencyText(claim.reward_name)}</strong><small>+{claim.amount} {currencyLabel(claim.currency, Number(claim.amount))} · sequência de {formatDays(claim.streak_days)}{claim.streak_bonus_name ? ` · bônus: ${localizeCurrencyText(claim.streak_bonus_name)}` : ''}</small></div>
                <time>{new Date(claim.created_at).toLocaleString('pt-BR')}</time>
              </div>
            ))}</div>}
          </section>
        </section>
      )}

      {(view === 'profile' || view === 'shop' || view === 'rankings') && profileData && (
        <ProfilePage data={profileData} onRefresh={refresh} page={view} />
      )}

      {view === 'draw' && <InvocationPage
        wallet={wallet}
        busy={busy}
        drawStatus={drawStatus}
        latest={latest}
        revealedCount={revealedCount}
        onDraw={(bannerId, quantity) => void draw(bannerId, quantity)}
        onRevealSound={() => playRevealSound()}
        soundEnabled={soundEnabled}
        onToggleSound={toggleSound}
        volume={volume}
        onVolumeChange={setVolume}
        onVolumeCommit={(value) => void savePreferences({ soundVolume: value })}
        invocationMusicEnabled={invocationMusicEnabled}
        onInvocationMusicEnabledChange={(enabled) => {
          setInvocationMusicEnabled(enabled);
          void savePreferences({ invocationMusicEnabled: enabled });
        }}
        reduceEffects={reduceEffects}
        systemReducedMotion={systemReducedMotion}
        onReduceEffectsChange={(enabled) => {
          setReduceEffects(enabled);
          void savePreferences({ reduceEffects: enabled });
          if (enabled && latest) setRevealedCount(latest.draws.length);
        }}
        onSkip={() => latest && setRevealedCount(latest.draws.length)}
      />}

      {view === 'collection' && (
        <section className="page-section">
          <SectionHeading eyebrow="SEU ACERVO" title="Coleção" />
          <div className="filter-bar">
            <input aria-label="Buscar carta" placeholder="Buscar por nome" value={filterName} onChange={(event) => setFilterName(event.target.value)} />
            <select aria-label="Filtrar por raridade" value={filterRarity} onChange={(event) => setFilterRarity(event.target.value)}><option value="">Todas as raridades</option>{rarityNames.map((name) => <option key={name}>{name}</option>)}</select>
            <select aria-label="Filtrar por categoria" value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)}><option value="">Todas as categorias</option>{categoryNames.map((name) => <option key={name}>{name}</option>)}</select>
            <select aria-label="Ordenar cartas" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="rarity">Raridade</option><option value="name">Nome</option><option value="quantity">Quantidade</option></select>
          </div>
          {visibleCollection.length === 0 ? <Empty text="Nenhuma carta corresponde aos filtros." /> : <div className="card-grid">{visibleCollection.map((card) => {
            const owned = collectionById.get(card.id);
            return <CardTile key={card.id} card={card} owned={owned?.quantity ?? 0} probability={probabilityFor(probabilityById.get(card.id))} silhouette={!owned} />;
          })}</div>}
        </section>
      )}

      {view === 'history' && (
        <section className="page-section">
          <SectionHeading eyebrow="REGISTROS PERSISTENTES" title="Histórico de sorteios" />
          <div className="filter-bar history-filters">
            <select aria-label="Filtrar histórico por raridade" value={historyRarity} onChange={(event) => setHistoryRarity(event.target.value)}><option value="">Todas as raridades</option>{rarityOptions.map((rarity) => <option key={rarity.id} value={rarity.id}>{rarity.name}</option>)}</select>
            <label>De <input type="datetime-local" value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)} /></label>
            <label>Até <input type="datetime-local" value={historyTo} onChange={(event) => setHistoryTo(event.target.value)} /></label>
            <button className="secondary-button" type="button" onClick={() => void applyHistoryFilters()}>Filtrar</button>
            <button className="quiet-button" type="button" onClick={() => void clearHistoryFilters()}>Limpar</button>
          </div>
          {history.length === 0 ? <Empty text="Ainda não há sorteios registrados." /> : <div className="admin-list history-list">{history.map((item) => <DrawHistoryRow key={item.id} item={item} />)}</div>}
        </section>
      )}

      {view === 'wallet' && (
        <section className="page-section">
          <SectionHeading eyebrow="ECONOMIA VIRTUAL" title="Sua carteira" />
          <div className="wallet-summary">
            <div className="wallet-currency-grid">
              <CurrencyBalance currency="gold" amount={wallet?.gold ?? null} variant="large" />
              <CurrencyBalance currency="gems" amount={wallet?.gems ?? null} variant="large" />
              <CurrencyBalance currency="xp" amount={wallet?.xp ?? null} variant="large" />
              <p className="muted">Todas as movimentações ficam registradas no extrato. A recompensa diária pode ser acessada separadamente das invocações.</p>
            </div>
            <button type="button" className="primary-button" onClick={() => setView('daily')}>Abrir recompensa diária</button>
          </div>
          <div className="ledger-panel full-ledger"><div className="section-heading compact"><div><p className="eyebrow">MOVIMENTAÇÕES</p><h2>Extrato</h2></div></div><TransactionList transactions={transactions} /></div>
        </section>
      )}

      <footer className="footer">
        <span>SORTESENAI</span>
        <span>Moedas virtuais · entretenimento</span>
      </footer>
      </div>
    </main>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty-panel"><span className="empty-icon">✧</span><p className="muted">{text}</p></div>;
}

function Icon({ name }: { name: IconName }) {
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>;
}

function CurrencyBalance({ currency, amount, variant }: { currency: Currency; amount: number | null; variant: 'topbar' | 'home' | 'large' }) {
  return <div className={`currency-balance currency-${variant} currency-${currency}`}>
    <span className="currency-icon"><Icon name={currency} /></span>
    <span className="currency-copy"><small>{currencyLabels[currency]}</small><strong>{amount === null ? '—' : amount.toLocaleString('pt-BR')}</strong></span>
  </div>;
}

function DashboardEmpty({ icon, title, description, action, onAction }: { icon: IconName; title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className="dashboard-empty">
    <span className="dashboard-empty-icon"><Icon name={icon} /></span>
    <div><h3>{title}</h3><p>{description}</p></div>
    {action && onAction && <button className="text-link" type="button" onClick={onAction}>{action}<Icon name="arrow" /></button>}
  </div>;
}

function RecentDrawItem({ item }: { item: DrawOutcome }) {
  return <article className="home-recent-row">
    <CardArtwork className="recent-draw-artwork" imagePath={item.image_path} alt={`${item.card_name} — ${item.rarity_name}`} />
    <span className="recent-draw-copy"><strong>{item.card_name}</strong><small>{item.rarity_name}{item.is_duplicate ? ' · duplicata convertida' : ''}</small></span>
    <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</time>
  </article>;
}

function CardTile({ card, owned, probability, silhouette = false, compact = false }: {
  card: CatalogCard;
  owned: number;
  probability?: { value: number; numerator: string; denominator: string };
  silhouette?: boolean;
  compact?: boolean;
}) {
  return <article className={`game-card level-${card.animation_level} ${silhouette ? 'undiscovered' : ''} ${compact ? 'compact-card' : ''}`} style={{ borderColor: `${card.color_primary}66` }}>
    <div className="card-art" style={{ backgroundColor: card.color_primary, borderBottom: `3px solid ${card.color_secondary}` }}>
      {silhouette
        ? <span className="card-silhouette" aria-hidden="true">?</span>
        : <CardArtwork imagePath={card.image_path} alt={`${card.name} — ${card.rarity_name}`} />}
      {owned > 0 && <b className="copy-count">×{owned}</b>}
    </div>
    <div className="game-card-copy"><span className="rarity-name" style={{ color: card.color_primary }}>{silhouette ? 'Não descoberta' : card.rarity_name}</span><strong>{silhouette ? '???' : card.name}</strong>{!compact && <small>{silhouette ? 'Uma carta aguarda descoberta.' : card.category_name ?? 'Sem categoria'}</small>}    {!silhouette && <small>Chance individual efetiva: {probability ? formatOdds(probability.numerator, probability.denominator, probability.value).fraction : '—'}</small>}</div>
  </article>;
}

function DrawHistoryRow({ item }: { item: DrawOutcome }) {
  const odds = formatOdds(item.effective_card_numerator, item.effective_card_denominator, item.effective_card_chance);
  const duplicateRewards = [
    Number(item.duplicate_gold_amount ?? 0) > 0 ? `+${Number(item.duplicate_gold_amount).toLocaleString('pt-BR')} ${currencyLabel('gold', Number(item.duplicate_gold_amount))}` : '',
    Number(item.duplicate_gems_amount ?? 0) > 0 ? `+${Number(item.duplicate_gems_amount).toLocaleString('pt-BR')} ${currencyLabel('gems', Number(item.duplicate_gems_amount))}` : '',
    Number(item.duplicate_xp_amount ?? 0) > 0 ? `+${Number(item.duplicate_xp_amount).toLocaleString('pt-BR')} XP` : ''
  ].filter(Boolean);
  const cost = item.unit_cost === undefined ? '' : ` · ${item.unit_cost} ${currencyLabel(item.currency ?? 'gold', Number(item.unit_cost))}`;
  const copies = item.collection_quantity === null || item.collection_quantity === undefined
    ? ''
    : ` · ${item.collection_quantity} ${item.collection_quantity === 1 ? 'cópia' : 'cópias'} na coleção`;
  return <div className="admin-list-row history-row"><CardArtwork className="history-card-artwork" imagePath={item.image_path} alt={`${item.card_name} — ${item.rarity_name}`} /><div><strong>{item.card_name} · {item.rarity_name}</strong><small>Chance individual {odds.fraction} · {odds.percent} · raridade {pct(item.effective_rarity_chance)}{cost}{copies}{item.is_duplicate ? ` · Duplicata convertida: ${duplicateRewards.join(' · ') || 'conversão registrada'}` : ''}</small></div><time>{new Date(item.created_at).toLocaleString('pt-BR')}</time></div>;
}

function TransactionList({ transactions }: { transactions: WalletTransaction[] }) {
  if (!transactions.length) return <div className="empty-ledger"><Icon name="wallet" /><span>Nenhuma movimentação por enquanto.</span></div>;
  return <ul className="ledger-list">{transactions.map((transaction) => <li key={transaction.id}>
    <span className={`ledger-symbol ${transaction.amount < 0 ? 'debit' : ''}`}><Icon name={transactionIcons[transaction.type] ?? 'wallet'} /></span>
    <span className="ledger-description"><strong>{transactionLabels[transaction.type] ?? transaction.type}</strong><small>{new Date(transaction.createdAt).toLocaleString('pt-BR')}</small></span>
    <span className={`ledger-amount ${transaction.amount < 0 ? 'debit' : ''}`}>{transaction.amount > 0 ? '+' : ''}{transaction.amount} {currencyLabel(transaction.currency, Math.abs(transaction.amount))}</span>
  </li>)}</ul>;
}

function pct(value: number): string {
  return `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 6 })}%`;
}

function probabilityFor(probability: Probability | undefined) {
  return probability ? {
    value: probability.effectiveCardChance,
    numerator: probability.effectiveCardNumerator,
    denominator: probability.effectiveCardDenominator
  } : undefined;
}


function formatDays(days: number): string {
  return `${days} ${days === 1 ? 'dia' : 'dias'}`;
}

function formatCountdown(milliseconds: number): string {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function parsePendingDraw(value: string): PendingDraw {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('A solicitação pendente está inválida. A chave foi preservada para evitar uma nova cobrança.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('A solicitação pendente está inválida. A chave foi preservada para evitar uma nova cobrança.');
  }
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.key !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.key)
    || typeof candidate.bannerId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.bannerId)
    || typeof candidate.quantity !== 'number'
    || !Number.isInteger(candidate.quantity)
    || candidate.quantity < 1
    || candidate.quantity > 10) {
    throw new Error('A solicitação pendente possui parâmetros inválidos. A chave foi preservada para evitar uma nova cobrança.');
  }
  return { key: candidate.key, bannerId: candidate.bannerId, quantity: candidate.quantity };
}
