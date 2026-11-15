import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { adminApi, type AdminCard, type AdminCategory, type AdminCosmetic, type AdminDailyReward, type AdminRarity, type AdminSettings, type Currency, type SpendableCurrency } from '../api';
import { currencyLabel, localizeCurrencyText } from '../currency';
import { InvocationAdmin } from './InvocationAdmin';
import { wheelColor } from './PrizeWheel';
import { CardArtwork } from './CardArtwork';

type Section = 'overview' | 'cards' | 'rarities' | 'categories' | 'economy' | 'daily' | 'invocation' | 'cosmetics' | 'draws' | 'wallet' | 'audit' | 'settings';
type Overview = { users: number; cards: { total: number; active: number }; draws: number };
type CardDraft = {
  id?: string;
  name: string;
  imagePath: string | null;
  description: string;
  categoryId: string | null;
  rarityId: string;
  weight: number;
  musicUrl: string | null;
  musicRightsConfirmed: boolean;
  active: boolean;
};
type RarityDraft = {
  id?: string;
  name: string;
  colorPrimary: string;
  colorSecondary: string;
  visualEffect: string;
  animationLevel: number;
  sortOrder: number;
  weight: number;
  duplicateTier: AdminRarity['duplicate_tier'];
  active: boolean;
};
type AuditRow = Awaited<ReturnType<typeof adminApi.logs>>['logs'][number];
type AdminDrawRow = Awaited<ReturnType<typeof adminApi.draws>>['draws'][number];
type DailyHistoryRow = Awaited<ReturnType<typeof adminApi.dailyHistory>>['claims'][number];
type WalletHistoryRow = Awaited<ReturnType<typeof adminApi.walletHistory>>['transactions'][number];
type RewardDraft = Omit<AdminDailyReward, 'id' | 'amount' | 'weight'> & { id?: string; amount: number; weight: number };
type MilestoneDraft = { consecutiveDays: number; name: string; currency: Currency; amount: number; active: boolean };
type CosmeticDraft = {
  id?: string;
  slug: string;
  kind: AdminCosmetic['kind'];
  name: string;
  description: string;
  previewPrimary: string;
  previewSecondary: string;
  priceAmount: number;
  priceCurrency: SpendableCurrency;
  requiredLevel: number;
  requiredAchievementKey: string | null;
  active: boolean;
};

const sectionGroups: Array<{
  label: string;
  items: Array<{ id: Section; label: string; description: string }>;
}> = [
  {
    label: 'Painel',
    items: [{
      id: 'overview',
      label: 'Visão geral',
      description: 'Indicadores atuais e alertas operacionais da plataforma.'
    }]
  },
  {
    label: 'Gerenciamento',
    items: [
      { id: 'cards', label: 'Cartas',       description: 'Cadastre cartas e configure o catálogo.' },
      { id: 'invocation', label: 'Invocação', description: 'Configure banners, pools, pesos, probabilidades e pity.' },
      { id: 'daily', label: 'Recompensas e loja', description: 'Administre recompensas diárias, sequências e itens cosméticos.' },
      { id: 'economy', label: 'Economia', description: 'Configure custos, conversões de duplicatas e carteiras.' }
    ]
  },
  {
    label: 'Acompanhamento',
    items: [
      { id: 'draws', label: 'Histórico', description: 'Consulte invocações, resgates diários e movimentações de carteira.' }
    ]
  },
  {
    label: 'Administração',
    items: [
      { id: 'settings', label: 'Configurações e auditoria', description: 'Ajuste configurações gerais e do catálogo e consulte a auditoria.' }
    ]
  }
];

function parentSection(section: Section): Section {
  if (['rarities', 'categories', 'audit', 'settings'].includes(section)) return 'settings';
  if (section === 'cosmetics') return 'daily';
  if (section === 'wallet') return 'economy';
  return section;
}

const emptyCard = (): CardDraft => ({
  name: '', imagePath: null, description: '', categoryId: null, rarityId: '',
  weight: 1, musicUrl: null, musicRightsConfirmed: false, active: true
});
const emptyRarity = (): RarityDraft => ({
  name: '', colorPrimary: '#FF4100', colorSecondary: '#1A34AE',
  visualEffect: 'glow', animationLevel: 1, sortOrder: 0, weight: 1,
  duplicateTier: null, active: true
});
const defaultSettings: AdminSettings = {
  drawCostGold: 10, drawCostGems: 1, drawCurrency: 'gold',
  drawEventEnabled: false, drawEventDiscountPercent: 0, drawEventStartsAt: null, drawEventEndsAt: null,
  signupBonus: 100, xpPerDraw: 0, distributionMode: 'individual',
  rarityCardSelection: 'equal', drawMaxQuantity: 10,
  loginMusicUrl: '', loginMusicRightsConfirmed: false
};
const emptyCosmetic = (): CosmeticDraft => ({
  slug: '', kind: 'avatar', name: '', description: '', previewPrimary: '#FF4100',
  previewSecondary: '#1A34AE', priceAmount: 0, priceCurrency: 'gold',
  requiredLevel: 1, requiredAchievementKey: null, active: true
});

export function AdminDashboard({ onClose, adminEmail }: { onClose: () => void; adminEmail: string }) {
  const [section, setSection] = useState<Section>('overview');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [cards, setCards] = useState<AdminCard[]>([]);
  const [rarities, setRarities] = useState<AdminRarity[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [settings, setSettings] = useState<AdminSettings>(defaultSettings);
  const [savedDistributionMode, setSavedDistributionMode] = useState<AdminSettings['distributionMode']>('individual');
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [draws, setDraws] = useState<AdminDrawRow[]>([]);
  const [dailyHistory, setDailyHistory] = useState<DailyHistoryRow[]>([]);
  const [walletHistory, setWalletHistory] = useState<WalletHistoryRow[]>([]);
  const [users, setUsers] = useState<Awaited<ReturnType<typeof adminApi.users>>['users']>([]);
  const [dailyRewards, setDailyRewards] = useState<RewardDraft[]>([]);
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([]);
  const [cosmetics, setCosmetics] = useState<AdminCosmetic[]>([]);
  const [cosmeticDraft, setCosmeticDraft] = useState<CosmeticDraft>(emptyCosmetic());
  const [cardDraft, setCardDraft] = useState<CardDraft>(emptyCard());
  const [rarityDraft, setRarityDraft] = useState<RarityDraft>(emptyRarity());
  const [categoryName, setCategoryName] = useState('');
  const [inlineCategoryName, setInlineCategoryName] = useState('');
  const [inlineCategoryOpen, setInlineCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<AdminCategory | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [selectedUser, setSelectedUser] = useState('');
  const [grantAmount, setGrantAmount] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [grantCurrency, setGrantCurrency] = useState<Currency>('gold');
  const [walletSearch, setWalletSearch] = useState('');
  const [cardSearch, setCardSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [walletHistoryType, setWalletHistoryType] = useState('all');
  const [auditSearch, setAuditSearch] = useState('');
  const [catalogSettingsTab, setCatalogSettingsTab] = useState<'rarities' | 'categories'>('rarities');
  const [settingsTab, setSettingsTab] = useState<'general' | 'catalog' | 'audit'>('general');
  const [economyTab, setEconomyTab] = useState<'rules' | 'conversions' | 'wallets'>('rules');
  const [rewardsTab, setRewardsTab] = useState<'daily' | 'cosmetics'>('daily');
  const [historyTab, setHistoryTab] = useState<'draws' | 'daily' | 'wallet'>('draws');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!imageFile) {
      setImagePreview('');
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const refresh = useCallback(async () => {
    const [summary, cardData, rarityData, categoryData, settingData,
      logData, drawData, userData, dailyData, cosmeticData, dailyHistoryData, walletHistoryData] = await Promise.all([
      adminApi.overview(), adminApi.cards(), adminApi.rarities(), adminApi.categories(),
      adminApi.settings(), adminApi.logs(),
      adminApi.draws(), adminApi.users(), adminApi.dailyRewards(), adminApi.cosmetics(),
      adminApi.dailyHistory(), adminApi.walletHistory()
    ]);
    setOverview(summary);
    setCards(cardData.cards);
    setRarities(rarityData.rarities);
    setCategories(categoryData.categories);
    setSettings(settingData.settings);
    setSavedDistributionMode(settingData.settings.distributionMode);
    setLogs(logData.logs);
    setDraws(drawData.draws);
    setDailyHistory(dailyHistoryData.claims);
    setWalletHistory(walletHistoryData.transactions);
    setUsers(userData.users);
    setDailyRewards(dailyData.rewards.map((reward) => ({
      ...reward, amount: Number(reward.amount), weight: Number(reward.weight)
    })));
    setMilestones(dailyData.milestones.map((milestone) => ({
      consecutiveDays: milestone.consecutive_days,
      name: milestone.name,
      currency: milestone.currency,
      amount: Number(milestone.amount),
      active: milestone.active
    })));
    setCosmetics(cosmeticData.cosmetics);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let active = true;
    void refresh()
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o painel administrativo.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [refresh]);

  async function reload() {
    if (busy) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await refresh();
      setNotice('Dados administrativos atualizados.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o painel administrativo.');
    } finally {
      setBusy(false);
    }
  }

  async function perform(action: () => Promise<unknown>, message: string): Promise<boolean> {
    if (busy) return false;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      try {
        await action();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a ação.');
        return false;
      }
      setNotice(message);
      try {
        await refresh();
      } catch (cause) {
        const detail = cause instanceof Error ? `: ${cause.message}` : '.';
        setError(`A ação foi concluída, mas não foi possível atualizar o painel${detail}`);
      }
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function saveCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      let imagePath = cardDraft.imagePath;
      if (imageFile) imagePath = (await adminApi.upload(imageFile)).imagePath;
      const body = { ...cardDraft, imagePath };
      if (cardDraft.id) await adminApi.updateCard(cardDraft.id, body);
      else await adminApi.createCard(body);
      await refresh();
      setCardDraft(emptyCard());
      clearImageFile();
      setNotice(cardDraft.id ? 'Carta atualizada.' : 'Carta criada.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a carta.');
    } finally {
      setBusy(false);
    }
  }

  async function saveRarity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!rarityDraft.duplicateTier) {
      setError('Selecione a faixa de conversão da raridade.');
      return;
    }
    setBusy(true);
    try {
      if (rarityDraft.id) await adminApi.updateRarity(rarityDraft.id, rarityDraft);
      else await adminApi.createRarity(rarityDraft);
      await refresh();
      setNotice(rarityDraft.id ? 'Raridade atualizada.' : 'Raridade criada.');
      setRarityDraft(emptyRarity());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a raridade.');
    } finally {
      setBusy(false);
    }
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = { name: categoryName, active: true };
    const succeeded = await perform(
      () => editingCategory
        ? adminApi.updateCategory(editingCategory.id, payload)
        : adminApi.createCategory(payload),
      editingCategory ? 'Categoria atualizada.' : 'Categoria criada.'
    );
    if (!succeeded) return;
    setCategoryName('');
    setEditingCategory(null);
  }

  async function addInlineCategory() {
    const name = inlineCategoryName.trim();
    if (!name || busy) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await adminApi.createCategory({ name, active: true });
      await refresh();
      setCardDraft((current) => ({ ...current, categoryId: result.category.id }));
      setInlineCategoryName('');
      setInlineCategoryOpen(false);
      setNotice('Categoria criada e selecionada.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar a categoria.');
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (settings.distributionMode !== savedDistributionMode
      && !window.confirm('Confirma alterar o modo de distribuição? As chances efetivas podem mudar.')) return;
    const payload = {
      ...settings,
      drawEventStartsAt: settings.drawEventStartsAt ? new Date(settings.drawEventStartsAt).toISOString() : null,
      drawEventEndsAt: settings.drawEventEndsAt ? new Date(settings.drawEventEndsAt).toISOString() : null
    };
    await perform(() => adminApi.updateSettings(payload), 'Configurações da plataforma salvas.');
  }

  async function grantCoins(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const succeeded = await perform(
      () => adminApi.adjustWallet(selectedUser, Number(grantAmount), grantCurrency, grantReason),
      'Movimentação da carteira registrada.'
    );
    if (!succeeded) return;
    setGrantAmount('');
    setGrantReason('');
  }

  async function saveDailyRewards() {
    const activeWeight = dailyRewards.filter((reward) => reward.active).reduce((total, reward) => total + reward.weight, 0);
    if (activeWeight !== 10_000) {
      setError('As probabilidades ativas da roleta diária devem totalizar 100% (10.000 pontos).');
      return;
    }
    await perform(
      () => adminApi.updateDailyRewards(dailyRewards.map((reward) => ({
        ...reward,
        colorPrimary: reward.color_primary,
        colorSecondary: reward.color_secondary
      }))),
      'Recompensas diárias atualizadas.'
    );
  }

  function updateReward(index: number, patch: Partial<RewardDraft>) {
    setDailyRewards((current) => current.map((reward, rewardIndex) =>
      rewardIndex === index ? { ...reward, ...patch } : reward
    ));
  }

  function updateMilestone(index: number, patch: Partial<MilestoneDraft>) {
    setMilestones((current) => current.map((milestone, milestoneIndex) =>
      milestoneIndex === index ? { ...milestone, ...patch } : milestone
    ));
  }

  async function saveStreaks() {
    await perform(() => adminApi.updateDailyStreaks(milestones), 'Marcos de sequência atualizados.');
  }

  async function saveCosmetic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { id, ...body } = cosmeticDraft;
    const succeeded = await perform(
      () => id ? adminApi.updateCosmetic(id, body) : adminApi.createCosmetic(body),
      id ? 'Item cosmético atualizado.' : 'Item cosmético criado.'
    );
    if (!succeeded) return;
    setCosmeticDraft(emptyCosmetic());
  }

  function editCosmetic(item: AdminCosmetic) {
    setCosmeticDraft({
      id: item.id,
      slug: item.slug,
      kind: item.kind,
      name: item.name,
      description: item.description,
      previewPrimary: item.preview_primary,
      previewSecondary: item.preview_secondary,
      priceAmount: Number(item.price_amount),
      priceCurrency: item.price_currency,
      requiredLevel: item.required_level,
      requiredAchievementKey: item.required_achievement_key,
      active: item.active
    });
  }

  function uploadImage(file: File | undefined): boolean {
    if (!file) return false;
    setError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setImageFile(null);
      setError('Use uma imagem PNG, JPG ou WebP.');
      return false;
    }
    if (file.size > 5 * 1024 * 1024) {
      setImageFile(null);
      setError('A imagem da carta deve ter no máximo 5 MB.');
      return false;
    }
    setImageFile(file);
    return true;
  }

  function clearImageFile() {
    setImageFile(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }

  const liveCards = cards.filter((card) => !card.deleted_at);
  const cardsMissingImage = liveCards.filter((card) => !card.image_path);
  const editingLegacyCardWithoutImage = Boolean(
    cardDraft.id
    && cardDraft.active
    && cards.some((card) => card.id === cardDraft.id && card.active && !card.image_path)
  );
  const imageRequiredForPublish = cardDraft.active
    && !cardDraft.imagePath
    && !imageFile
    && !editingLegacyCardWithoutImage;
  const liveRarities = rarities.filter((rarity) => !rarity.deleted_at);
  const liveCategories = categories.filter((category) => !category.deleted_at);
  const normalizedCardSearch = cardSearch.trim().toLowerCase();
  const searchedCards = liveCards.filter((card) =>
    `${card.name} ${card.rarity_name} ${card.category_name ?? ''}`.toLowerCase().includes(normalizedCardSearch)
  );
  const normalizedHistorySearch = historySearch.trim().toLowerCase();
  const inHistoryRange = (value: string) => {
    const date = new Date(value).toLocaleDateString('sv-SE');
    return (!historyFrom || date >= historyFrom) && (!historyTo || date <= historyTo);
  };
  const searchedDraws = draws.filter((draw) =>
    `${draw.card_name} ${draw.rarity_name} ${draw.user_email}`.toLowerCase().includes(normalizedHistorySearch)
    && inHistoryRange(draw.created_at)
  );
  const searchedDailyHistory = dailyHistory.filter((claim) =>
    `${claim.reward_name} ${claim.user_email} ${claim.streak_bonus_name ?? ''}`.toLowerCase().includes(normalizedHistorySearch)
    && inHistoryRange(claim.created_at)
  );
  const searchedWalletHistory = walletHistory.filter((transaction) =>
    `${transaction.user_email} ${transaction.type} ${transaction.currency} ${transaction.reference_type ?? ''}`.toLowerCase().includes(normalizedHistorySearch)
    && (walletHistoryType === 'all' || transaction.type === walletHistoryType)
    && inHistoryRange(transaction.created_at)
  );
  const walletHistoryTypes = [...new Set(walletHistory.map((transaction) => transaction.type))].sort();
  const normalizedAuditSearch = auditSearch.trim().toLowerCase();
  const searchedLogs = logs.filter((log) =>
    `${log.action} ${log.entity_type} ${log.actor_email ?? ''}`.toLowerCase().includes(normalizedAuditSearch)
  );
  const normalizedWalletSearch = walletSearch.trim().toLowerCase();
  const searchedUsers = users.filter((user) => user.email.toLowerCase().includes(normalizedWalletSearch));
  const currentSection = sectionGroups
    .flatMap((group) => group.items)
    .find((item) => item.id === parentSection(section))!;

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div className="admin-brand" aria-label="SorteSenai">
          <span>SORTE</span>SENAI
        </div>
        <div className="admin-header-copy">
          <p className="eyebrow">CONTROLE DA PLATAFORMA</p>
          <h1>Painel administrativo</h1>
          <p>{currentSection.description}</p>
        </div>
        <div className="admin-header-actions">
          <div className="admin-identity">
            <span className="admin-role">ADMIN</span>
            <span className="admin-email">{adminEmail}</span>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>Voltar ao jogo</button>
        </div>
      </header>
      <div className="admin-layout">
        <nav className="admin-nav" aria-label="Seções administrativas">
          {sectionGroups.map((group) => (
            <div className="admin-nav-group" key={group.label}>
              <h2>{group.label}</h2>
              {group.items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-current={parentSection(section) === item.id ? 'page' : undefined}
                  className={parentSection(section) === item.id ? 'active' : ''}
                  onClick={() => {
                    setSection(item.id);
                    if (item.id === 'settings') setSettingsTab('general');
                    if (item.id === 'daily') setRewardsTab('daily');
                    if (item.id === 'economy') setEconomyTab('rules');
                    if (item.id === 'draws') setHistoryTab('draws');
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <section className="admin-content" aria-busy={loading}>
          {loading && (
            <div className="admin-state" role="status">
              <span className="admin-spinner" aria-hidden="true" />
              <div><strong>Carregando dados administrativos</strong><p>Aguarde enquanto consultamos a plataforma.</p></div>
            </div>
          )}
          {!loading && !loaded && (
            <div className="admin-state admin-state-error" role="alert">
              <div>
                <h2>Não foi possível carregar o painel</h2>
                <p>{error || 'Verifique sua conexão e tente novamente.'}</p>
              </div>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void reload()}>
                {busy ? 'Tentando novamente...' : 'Tentar novamente'}
              </button>
            </div>
          )}
          {loaded && (
            <>
              {error && <p className="message error" role="alert">{error}</p>}
              {notice && <p className="message success" role="status">{notice}</p>}

          {parentSection(section) === 'settings' && <SectionTabs
            label="Configurações administrativas"
            active={settingsTab}
            tabs={[{ id: 'general', label: 'Geral' }, { id: 'catalog', label: 'Catálogo' }, { id: 'audit', label: 'Auditoria' }]}
            onSelect={(id) => {
              if (id === 'general') {
                setSettingsTab('general');
                setSection('settings');
              } else if (id === 'catalog') {
                setSettingsTab('catalog');
                setSection(catalogSettingsTab);
              } else if (id === 'audit') {
                setSettingsTab('audit');
                setSection('audit');
              }
            }}
          />}
          {parentSection(section) === 'settings' && settingsTab === 'catalog' && <SectionTabs
            label="Configurações do catálogo"
            active={catalogSettingsTab}
            tabs={[{ id: 'rarities', label: 'Raridades' }, { id: 'categories', label: 'Categorias' }]}
            onSelect={(id) => {
              if (id === 'rarities' || id === 'categories') {
                setCatalogSettingsTab(id);
                setSection(id);
              }
            }}
          />}
          {parentSection(section) === 'economy' && <SectionTabs
            label="Economia"
            active={economyTab}
            tabs={[{ id: 'rules', label: 'Regras' }, { id: 'conversions', label: 'Duplicatas' }, { id: 'wallets', label: 'Carteiras' }]}
            onSelect={(id) => {
              if (id === 'rules') {
                setEconomyTab('rules');
                setSection('economy');
              } else if (id === 'conversions') {
                setEconomyTab('conversions');
                setSection('economy');
              } else if (id === 'wallets') {
                setEconomyTab('wallets');
                setSection('wallet');
              }
            }}
          />}
          {parentSection(section) === 'daily' && <SectionTabs
            label="Recompensas e loja"
            active={rewardsTab}
            tabs={[{ id: 'daily', label: 'Recompensa diária' }, { id: 'cosmetics', label: 'Loja cosmética' }]}
            onSelect={(id) => {
              if (id === 'daily') {
                setRewardsTab('daily');
                setSection('daily');
              } else if (id === 'cosmetics') {
                setRewardsTab('cosmetics');
                setSection('cosmetics');
              }
            }}
          />}
          {section === 'draws' && <SectionTabs
            label="Histórico"
            active={historyTab}
            tabs={[{ id: 'draws', label: 'Invocações' }, { id: 'daily', label: 'Resgates diários' }, { id: 'wallet', label: 'Carteiras' }]}
            onSelect={(id) => {
              if (id === 'draws' || id === 'daily' || id === 'wallet') setHistoryTab(id);
            }}
          />}

          {section === 'overview' && (
            <>
              <div className="admin-title-row">
                <div><p className="eyebrow">RESUMO OPERACIONAL</p><h2>Visão geral</h2></div>
                <button className="secondary-button" type="button" disabled={busy} onClick={() => void reload()}>
                  {busy ? 'Atualizando...' : 'Atualizar dados'}
                </button>
              </div>
              <div className="stat-grid">
                <Stat label="Contas cadastradas" value={overview?.users ?? null} detail="Contas não excluídas" />
                <Stat
                  label="Cartas ativas"
                  value={overview?.cards.active ?? null}
                  detail={overview ? `${overview.cards.total} no catálogo` : 'Dados indisponíveis'}
                />
                <Stat label="Sorteios registrados" value={overview?.draws ?? null} detail="Total de resultados persistidos" />
              </div>
              <div className="admin-overview-actions" aria-label="Ações frequentes">
                <span>Ações frequentes</span>
                <button type="button" className="quiet-button" onClick={() => setSection('cards')}>Cadastrar carta <span aria-hidden="true">→</span></button>
                <button type="button" className="quiet-button" onClick={() => setSection('invocation')}>Configurar invocação <span aria-hidden="true">→</span></button>
              </div>
              <div className="admin-overview-grid">
                <section className="admin-overview-panel" aria-labelledby="admin-recent-draws-heading">
                  <div className="admin-panel-heading">
                    <div><p className="eyebrow">ATIVIDADE</p><h3 id="admin-recent-draws-heading">Sorteios recentes</h3></div>
                    <button type="button" className="quiet-button" onClick={() => setSection('draws')}>Ver histórico <span aria-hidden="true">→</span></button>
                  </div>
                  {draws.length === 0
                    ? <AdminEmpty title="Sem sorteios registrados" description="Os resultados mais recentes aparecerão aqui." />
                    : <div className="admin-activity-list">{draws.slice(0, 5).map((draw) => (
                      <div className="admin-activity-row" key={draw.id}>
                        <div><strong>{draw.card_name}</strong><small>{draw.rarity_name} · {draw.user_email}</small></div>
                        <time dateTime={draw.created_at}>{new Date(draw.created_at).toLocaleDateString('pt-BR')}</time>
                      </div>
                    ))}</div>}
                </section>
              </div>
            </>
          )}

          {section === 'cards' && (
            <>
              <div className="admin-title-row"><div><p className="eyebrow">CATÁLOGO</p><h2>{cardDraft.id ? 'Editar carta' : 'Nova carta'}</h2></div></div>
              <form className="admin-form" onSubmit={saveCard}>
                <label>Nome<input required maxLength={100} value={cardDraft.name} onChange={(event) => setCardDraft({ ...cardDraft, name: event.target.value })} /></label>
                <label>Raridade<select required value={cardDraft.rarityId} onChange={(event) => setCardDraft({ ...cardDraft, rarityId: event.target.value })}><option value="">Selecione</option>{liveRarities.map((rarity) => <option key={rarity.id} value={rarity.id}>{rarity.name}</option>)}</select></label>
                <label>Categoria<select value={cardDraft.categoryId ?? ''} onChange={(event) => setCardDraft({ ...cardDraft, categoryId: event.target.value || null })}><option value="">Sem categoria</option>{liveCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
                <label className="check-label"><input type="checkbox" checked={cardDraft.active} onChange={(event) => setCardDraft({ ...cardDraft, active: event.target.checked })} /> Carta ativa</label>
                <section className="card-image-editor wide-field" aria-labelledby="card-image-title">
                  <div><h3 id="card-image-title">Imagem da carta</h3>
                    <p>PNG, JPG ou WebP · até 5 MB · máximo de 4096 px por lado e 16 megapixels.</p>
                    {editingLegacyCardWithoutImage && <p className="legacy-image-note">Esta carta antiga está sem imagem e foi preservada. Complete o cadastro para remover o aviso de pendência.</p>}
                  </div>
                  <div className="card-image-editor-content">
                    <CardArtwork
                      className="card-image-editor-preview"
                      imagePath={imagePreview || cardDraft.imagePath}
                      alt={cardDraft.name || 'Prévia da imagem da carta'}
                      loading="eager"
                    />
                    <div className="card-image-editor-controls">
                      <label>Selecionar imagem
                        <span className="image-file-picker">
                          <span className="image-file-picker-button">Escolher imagem</span>
                          <span className="image-file-picker-name" title={imageFile?.name ?? cardDraft.imagePath?.split('/').pop() ?? ''}>
                            {imageFile?.name ?? cardDraft.imagePath?.split('/').pop() ?? 'Nenhum arquivo selecionado'}
                          </span>
                          <input
                            ref={imageInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            required={imageRequiredForPublish}
                            onChange={(event) => {
                              if (!uploadImage(event.currentTarget.files?.[0])) event.currentTarget.value = '';
                            }}
                          />
                        </span>
                        <small>Visualize a prévia antes de salvar a carta.</small>
                      </label>
                      {cardDraft.imagePath && <p className="admin-note">Imagem cadastrada; selecione outra para substituir.</p>}
                      {imageFile && <button type="button" className="quiet-button" disabled={busy} onClick={clearImageFile}>Cancelar substituição</button>}
                      {cardDraft.imagePath && <button
                        type="button"
                        className="quiet-button danger-text"
                        disabled={busy || cardDraft.active}
                        onClick={() => setCardDraft({ ...cardDraft, imagePath: null })}
                      >{cardDraft.active ? 'Desative a carta para remover a imagem' : 'Remover imagem cadastrada'}</button>}
                    </div>
                  </div>
                </section>
                <div className="wide-field inline-category-creator">
                  <button type="button" className="quiet-button" onClick={() => setInlineCategoryOpen(!inlineCategoryOpen)}>
                    {inlineCategoryOpen ? 'Cancelar nova categoria' : '+ Criar categoria'}
                  </button>
                  {inlineCategoryOpen && <div className="inline-form">
                    <input aria-label="Nome da nova categoria" maxLength={100} value={inlineCategoryName} onChange={(event) => setInlineCategoryName(event.target.value)} placeholder="Nome da categoria" />
                    <button type="button" className="secondary-button" disabled={busy || !inlineCategoryName.trim()} onClick={() => void addInlineCategory()}>{busy ? 'Criando...' : 'Criar e selecionar'}</button>
                  </div>}
                </div>
                <details className="admin-advanced wide-field">
                  <summary>Configurações avançadas</summary>
                  <div className="admin-form">
                    <label>Peso da carta<input type="number" min="1" step="1" required value={cardDraft.weight} onChange={(event) => setCardDraft({ ...cardDraft, weight: Number(event.target.value) })} /></label>
                    <label className="wide-field">Descrição<textarea rows={3} maxLength={2000} value={cardDraft.description} onChange={(event) => setCardDraft({ ...cardDraft, description: event.target.value })} /></label>
                    <label className="wide-field">Link do YouTube (opcional)
                      <input type="url" maxLength={2048} value={cardDraft.musicUrl ?? ''} onChange={(event) => setCardDraft({ ...cardDraft, musicUrl: event.target.value || null, musicRightsConfirmed: false })} placeholder="https://youtu.be/..." />
                    </label>
                    {cardDraft.musicUrl && <label className="check-label wide-field">
                      <input type="checkbox" checked={cardDraft.musicRightsConfirmed} onChange={(event) => setCardDraft({ ...cardDraft, musicRightsConfirmed: event.target.checked })} />
                      Confirmo que este conteúdo é próprio, autorizado pelo titular ou licenciado para incorporação.
                    </label>}
                  </div>
                </details>
                <div className="form-actions wide-field"><button className="primary-button" disabled={busy || liveRarities.length === 0}>{busy ? imageFile ? 'Enviando imagem e salvando...' : 'Salvando...' : 'Salvar carta'}</button>{cardDraft.id && <button className="quiet-button" type="button" onClick={() => { setCardDraft(emptyCard()); clearImageFile(); }}>Cancelar edição</button>}</div>
              </form>
              <div className="admin-toolbar">
                <label className="admin-search">
                  <span>Buscar cartas</span>
                  <input
                    type="search"
                    aria-label="Buscar carta por nome, raridade ou categoria"
                    placeholder="Nome, raridade ou categoria"
                    value={cardSearch}
                    onChange={(event) => setCardSearch(event.target.value)}
                  />
                </label>
                <span className="admin-results">{searchedCards.length} de {liveCards.length} cartas · {cardsMissingImage.length} pendentes de imagem</span>
              </div>
              {cardsMissingImage.length > 0 && <p className="legacy-image-note" role="status">
                {cardsMissingImage.length} carta(s) antiga(s) ainda não têm imagem. Elas foram preservadas e aparecem com um marcador neutro; edite cada cadastro para completar a imagem.
              </p>}
              {searchedCards.length === 0
                ? <AdminEmpty
                  title={normalizedCardSearch ? 'Nenhuma carta encontrada' : 'Nenhuma carta cadastrada'}
                  description={normalizedCardSearch ? 'Ajuste a busca e tente novamente.' : 'Cadastre uma carta para começar a montar o catálogo.'}
                />
                : <div className="admin-list">
                {searchedCards.map((card) => (
                  <div className="admin-list-row" key={card.id}>
                    <CardArtwork className="admin-card-thumb" imagePath={card.image_path} alt={`${card.name} — ${card.rarity_name}`} />
                    <div><strong>{card.name}</strong><small>{card.rarity_name} · {card.category_name ?? 'Sem categoria'}{!card.image_path ? ' · Pendente de imagem' : ''}</small></div>
                    <div className="row-actions">
                      <button type="button" className="quiet-button" onClick={() => {
                        clearImageFile();
                        setCardDraft({
                          id: card.id, name: card.name, imagePath: card.image_path, description: card.description,
                          categoryId: card.category_id, rarityId: card.rarity_id, weight: Number(card.weight),
                          musicUrl: card.youtube_video_id ? `https://youtu.be/${card.youtube_video_id}` : null,
                          musicRightsConfirmed: false,
                          active: card.active
                        });
                      }}>Editar</button>
                      <button type="button" className="quiet-button danger-text" disabled={busy} onClick={() => window.confirm(`Remover ${card.name}?`) && void perform(() => adminApi.deleteCard(card.id), 'Carta removida.')}>Remover</button>
                    </div>
                  </div>
                ))}
              </div>}
            </>
          )}

          {section === 'rarities' && (
            <>
              <div className="admin-title-row"><div><p className="eyebrow">APARÊNCIA E PESOS</p><h2>{rarityDraft.id ? 'Editar raridade' : 'Nova raridade'}</h2></div></div>
              <form className="admin-form" onSubmit={saveRarity}>
                <label>Nome<input required maxLength={100} value={rarityDraft.name} onChange={(event) => setRarityDraft({ ...rarityDraft, name: event.target.value })} /></label>
                <label>Cor principal<input type="color" value={rarityDraft.colorPrimary} onChange={(event) => setRarityDraft({ ...rarityDraft, colorPrimary: event.target.value })} /></label>
                <label>Cor secundária<input type="color" value={rarityDraft.colorSecondary} onChange={(event) => setRarityDraft({ ...rarityDraft, colorSecondary: event.target.value })} /></label>
                <label>Peso (modo por raridade)<input type="number" min="1" value={rarityDraft.weight} onChange={(event) => setRarityDraft({ ...rarityDraft, weight: Number(event.target.value) })} /></label>
                <label>Efeito visual<select value={rarityDraft.visualEffect} onChange={(event) => setRarityDraft({ ...rarityDraft, visualEffect: event.target.value })}><option value="glow">Brilho</option><option value="particles">Partículas</option><option value="reveal">Revelação</option><option value="aura">Aura</option></select></label>
                <label>Nível de animação<select value={rarityDraft.animationLevel} onChange={(event) => setRarityDraft({ ...rarityDraft, animationLevel: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
                <label>Ordem<input type="number" value={rarityDraft.sortOrder} onChange={(event) => setRarityDraft({ ...rarityDraft, sortOrder: Number(event.target.value) })} /></label>
                <label>Faixa de conversão de duplicatas<select required value={rarityDraft.duplicateTier ?? ''} onChange={(event) => setRarityDraft({ ...rarityDraft, duplicateTier: (event.target.value || null) as RarityDraft['duplicateTier'] })}><option value="" disabled>Selecione uma faixa</option><option value="common">Comum</option><option value="uncommon">Incomum</option><option value="rare">Rara</option><option value="epic">Épica</option><option value="legendary">Lendária</option><option value="secret">Secreta</option></select></label>
                <label className="check-label"><input type="checkbox" checked={rarityDraft.active} onChange={(event) => setRarityDraft({ ...rarityDraft, active: event.target.checked })} /> Ativa</label>
                <div className="form-actions wide-field"><button className="primary-button" disabled={busy}>{rarityDraft.id ? 'Salvar alterações' : 'Criar raridade'}</button>{rarityDraft.id && <button type="button" className="quiet-button" onClick={() => setRarityDraft(emptyRarity())}>Cancelar</button>}</div>
              </form>
              {liveRarities.length === 0
                ? <AdminEmpty title="Nenhuma raridade cadastrada" description="Cadastre raridades antes de criar cartas no catálogo." />
                : <div className="admin-list">{liveRarities.map((rarity) => <div className="admin-list-row" key={rarity.id}>
                  <div className="rarity-label"><span className="rarity-dot" style={{ background: rarity.color_primary }} /><strong>{rarity.name}</strong><small>Peso {rarity.weight} · nível {rarity.animation_level}</small></div>
                  <div className="row-actions"><button type="button" className="quiet-button" onClick={() => setRarityDraft({
                    id: rarity.id, name: rarity.name, colorPrimary: rarity.color_primary, colorSecondary: rarity.color_secondary,
                    visualEffect: rarity.visual_effect, animationLevel: rarity.animation_level, sortOrder: rarity.sort_order,
                    weight: Number(rarity.weight), duplicateTier: rarity.duplicate_tier, active: rarity.active
                  })}>Editar</button><button type="button" className="quiet-button danger-text" disabled={busy} onClick={() => window.confirm(`Remover ${rarity.name}?`) && void perform(() => adminApi.deleteRarity(rarity.id), 'Raridade removida.')}>Remover</button></div>
                </div>)}</div>}
            </>
          )}

          {section === 'categories' && (
            <>
              <div className="admin-title-row"><div><p className="eyebrow">ORGANIZAÇÃO</p><h2>Categorias</h2></div></div>
              <form className="inline-form" onSubmit={saveCategory}><input required maxLength={100} aria-label="Nome da categoria" placeholder="Nome da categoria" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} /><button className="primary-button" disabled={busy}>{busy ? 'Salvando...' : editingCategory ? 'Salvar' : 'Adicionar categoria'}</button>{editingCategory && <button type="button" className="quiet-button" disabled={busy} onClick={() => { setEditingCategory(null); setCategoryName(''); }}>Cancelar</button>}</form>
              {liveCategories.length === 0
                ? <AdminEmpty title="Nenhuma categoria cadastrada" description="As cartas também podem ficar sem categoria." />
                : <div className="admin-list">{liveCategories.map((category) => <div className="admin-list-row" key={category.id}><div><strong>{category.name}</strong></div><div className="row-actions"><button type="button" className="quiet-button" disabled={busy} onClick={() => { setEditingCategory(category); setCategoryName(category.name); }}>Editar</button><button type="button" className="quiet-button danger-text" disabled={busy} onClick={() => window.confirm(`Remover ${category.name}?`) && void perform(() => adminApi.deleteCategory(category.id), 'Categoria removida.')}>Remover</button></div></div>)}</div>}
            </>
          )}

          {section === 'economy' && economyTab === 'rules' && (
            <>
              <div className="admin-title-row"><div><p className="eyebrow">REGRAS GLOBAIS</p><h2>Economia e sorteio</h2></div></div>
              <form className="admin-form" onSubmit={saveSettings}>
                <label>Moeda de cobrança<select value={settings.drawCurrency} onChange={(event) => setSettings({ ...settings, drawCurrency: event.target.value as SpendableCurrency })}><option value="gold">Moedas</option><option value="gems">Gemas</option></select></label>
                <label>Custo em moedas<input type="number" min="1" required value={settings.drawCostGold} onChange={(event) => setSettings({ ...settings, drawCostGold: Number(event.target.value) })} /></label>
                <label>Custo em gemas<input type="number" min="1" required value={settings.drawCostGems} onChange={(event) => setSettings({ ...settings, drawCostGems: Number(event.target.value) })} /></label>
                <label>Bônus de cadastro<input type="number" min="0" required value={settings.signupBonus} onChange={(event) => setSettings({ ...settings, signupBonus: Number(event.target.value) })} /></label>
                <label>XP por carta sorteada<input type="number" min="0" required value={settings.xpPerDraw} onChange={(event) => setSettings({ ...settings, xpPerDraw: Number(event.target.value) })} /></label>
                <label>Quantidade máxima (1–10)<input type="number" min="1" max="10" required value={settings.drawMaxQuantity} onChange={(event) => setSettings({ ...settings, drawMaxQuantity: Number(event.target.value) })} /></label>
                <label>Modo de distribuição<select value={settings.distributionMode} onChange={(event) => setSettings({ ...settings, distributionMode: event.target.value as AdminSettings['distributionMode'] })}><option value="individual">Por carta</option><option value="rarity">Por raridade</option></select></label>
                <label>Seleção dentro da raridade<select value={settings.rarityCardSelection} onChange={(event) => setSettings({ ...settings, rarityCardSelection: event.target.value as AdminSettings['rarityCardSelection'] })}><option value="equal">Peso igual</option><option value="weighted">Peso de cada carta</option></select></label>
                <label className="check-label"><input type="checkbox" checked={settings.drawEventEnabled} onChange={(event) => setSettings({ ...settings, drawEventEnabled: event.target.checked })} /> Ativar promoção do sorteio</label>
                <label>Desconto promocional (%)<input type="number" min="0" max="99" value={settings.drawEventDiscountPercent} onChange={(event) => setSettings({ ...settings, drawEventDiscountPercent: Number(event.target.value) })} /></label>
                <label>Início da promoção<input type="datetime-local" value={toLocalDateTimeInput(settings.drawEventStartsAt)} onChange={(event) => setSettings({ ...settings, drawEventStartsAt: event.target.value || null })} /></label>
                <label>Fim da promoção<input type="datetime-local" value={toLocalDateTimeInput(settings.drawEventEndsAt)} onChange={(event) => setSettings({ ...settings, drawEventEndsAt: event.target.value || null })} /></label>
                <div className="form-actions wide-field"><button className="primary-button" disabled={busy}>Salvar configurações</button></div>
              </form>
            </>
          )}

          {section === 'settings' && settingsTab === 'general' && (
            <>
              <div className="admin-title-row"><div><p className="eyebrow">CONFIGURAÇÕES GERAIS</p><h2>Experiência de acesso</h2></div></div>
              <form className="admin-form" onSubmit={saveSettings}>
                <div className="wide-field admin-login-music-heading"><h3>Música da página de acesso</h3><p className="admin-note">Opcional. A pessoa visitante inicia a reprodução manualmente; somente links HTTPS oficiais do YouTube são aceitos.</p></div>
                <label className="wide-field">URL do YouTube<input type="url" maxLength={2048} placeholder="https://www.youtube.com/watch?v=..." value={settings.loginMusicUrl} onChange={(event) => setSettings({ ...settings, loginMusicUrl: event.target.value, loginMusicRightsConfirmed: false })} /></label>
                <label className="check-label wide-field"><input type="checkbox" checked={settings.loginMusicRightsConfirmed} onChange={(event) => setSettings({ ...settings, loginMusicRightsConfirmed: event.target.checked })} /> Confirmo que tenho autorização para incorporar esta música.</label>
                <div className="form-actions wide-field"><button className="primary-button" disabled={busy}>Salvar configurações gerais</button></div>
              </form>
            </>
          )}

          {section === 'economy' && economyTab === 'conversions' && <InvocationAdmin mode="conversions" cards={liveCards} rarities={liveRarities} />}

          {section === 'daily' && rewardsTab === 'daily' && (
            <>
              <div className="admin-title-row"><div><p className="eyebrow">RECOMPENSAS E SEQUÊNCIAS</p><h2>Roleta diária</h2></div></div>
              <div className="admin-title-row"><h3>Recompensas ativas: peso total {dailyRewards.filter((reward) => reward.active).reduce((total, reward) => total + reward.weight, 0)} / 10.000</h3>
                <button type="button" className="secondary-button" onClick={() => setDailyRewards([...dailyRewards, {
                  name: 'Nova recompensa', description: '', currency: 'gold', amount: 10, weight: 1,
                  color_primary: wheelColor(dailyRewards.length), color_secondary: '#FFFFFF', active: false, sort_order: dailyRewards.length
                }])}>Adicionar recompensa</button>
              </div>
              {dailyRewards.length === 0
                ? <AdminEmpty title="Nenhuma recompensa configurada" description="Adicione recompensas para configurar a roleta diária." />
                : <div className="daily-admin-list">{dailyRewards.map((reward, index) => (
                <article className="daily-admin-row" key={reward.id ?? `new-${index}`}>
                  <label>Nome<input value={reward.name} onChange={(event) => updateReward(index, { name: event.target.value })} /></label>
                  <label>Descrição<input value={reward.description} onChange={(event) => updateReward(index, { description: event.target.value })} /></label>
                  <label>Moeda<select value={reward.currency} onChange={(event) => updateReward(index, { currency: event.target.value as Currency })}><option value="gold">Moedas</option><option value="gems">Gemas</option><option value="xp">XP</option></select></label>
                  <label>Quantidade<input type="number" min="1" value={reward.amount} onChange={(event) => updateReward(index, { amount: Number(event.target.value) })} /></label>
                  <label>Peso (10.000 = 100%)<input type="number" min="1" max="10000" value={reward.weight} onChange={(event) => updateReward(index, { weight: Number(event.target.value) })} /></label>
                  <label>Ordem<input type="number" min="0" value={reward.sort_order} onChange={(event) => updateReward(index, { sort_order: Number(event.target.value) })} /></label>
                  <label>Cor principal<input type="color" value={reward.color_primary} onChange={(event) => updateReward(index, { color_primary: event.target.value })} /></label>
                  <label>Cor secundária<input type="color" value={reward.color_secondary} onChange={(event) => updateReward(index, { color_secondary: event.target.value })} /></label>
                  <label className="check-label"><input type="checkbox" checked={reward.active} onChange={(event) => updateReward(index, { active: event.target.checked })} /> Ativa</label>
                  <button type="button" className="quiet-button danger-text" onClick={() => setDailyRewards(dailyRewards.filter((_, rewardIndex) => rewardIndex !== index))}>Remover da lista</button>
                </article>
              ))}</div>}
              <button type="button" className="primary-button" disabled={busy} onClick={() => void saveDailyRewards()}>Salvar recompensas</button>

              <div className="admin-title-row daily-streak-heading"><div><p className="eyebrow">BÔNUS POR PRESENÇA</p><h3>Marcos de sequência</h3></div>
                <button type="button" className="secondary-button" onClick={() => setMilestones([...milestones, {
                  consecutiveDays: 7, name: 'Novo marco', currency: 'gold', amount: 25, active: true
                }])}>Adicionar marco</button>
              </div>
              {milestones.length === 0
                ? <AdminEmpty title="Sem marcos de sequência" description="Adicione um marco para oferecer bônus por presença consecutiva." />
                : <div className="daily-admin-list">{milestones.map((milestone, index) => (
                <article className="daily-admin-row streak-admin-row" key={`${milestone.consecutiveDays}-${index}`}>
                  <label>Dias consecutivos<input type="number" min="1" value={milestone.consecutiveDays} onChange={(event) => updateMilestone(index, { consecutiveDays: Number(event.target.value) })} /></label>
                  <label>Nome<input value={milestone.name} onChange={(event) => updateMilestone(index, { name: event.target.value })} /></label>
                  <label>Moeda<select value={milestone.currency} onChange={(event) => updateMilestone(index, { currency: event.target.value as Currency })}><option value="gold">Moedas</option><option value="gems">Gemas</option><option value="xp">XP</option></select></label>
                  <label>Quantidade<input type="number" min="1" value={milestone.amount} onChange={(event) => updateMilestone(index, { amount: Number(event.target.value) })} /></label>
                  <label className="check-label"><input type="checkbox" checked={milestone.active} onChange={(event) => updateMilestone(index, { active: event.target.checked })} /> Ativo</label>
                  <button type="button" className="quiet-button danger-text" onClick={() => setMilestones(milestones.filter((_, itemIndex) => itemIndex !== index))}>Remover</button>
                </article>
              ))}</div>}
              <button type="button" className="primary-button" disabled={busy} onClick={() => void saveStreaks()}>Salvar marcos</button>
            </>
          )}

          {section === 'invocation' && <InvocationAdmin cards={liveCards} rarities={liveRarities} />}

          {section === 'cosmetics' && rewardsTab === 'cosmetics' && (
            <>
              <div className="admin-title-row"><div><p className="eyebrow">PERSONALIZAÇÃO</p><h2>{cosmeticDraft.id ? 'Editar item cosmético' : 'Novo item cosmético'}</h2></div></div>
              <form className="admin-form" onSubmit={(event) => void saveCosmetic(event)}>
                <label>Slug<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={80} value={cosmeticDraft.slug} onChange={(event) => setCosmeticDraft({ ...cosmeticDraft, slug: event.target.value })} /></label>
                <label>Tipo<select value={cosmeticDraft.kind} onChange={(event) => setCosmeticDraft({ ...cosmeticDraft, kind: event.target.value as CosmeticDraft['kind'] })}><option value="avatar">Avatar</option><option value="banner">Banner</option><option value="frame">Moldura</option><option value="effect">Efeito</option><option value="title">Título</option></select></label>
                <label>Nome<input required maxLength={80} value={cosmeticDraft.name} onChange={(event) => setCosmeticDraft({ ...cosmeticDraft, name: event.target.value })} /></label>
                <label>Descrição<input maxLength={240} value={cosmeticDraft.description} onChange={(event) => setCosmeticDraft({ ...cosmeticDraft, description: event.target.value })} /></label>
                <label>Cor principal<input type="color" value={cosmeticDraft.previewPrimary} onChange={(event) => setCosmeticDraft({ ...cosmeticDraft, previewPrimary: event.target.value })} /></label>
                <label>Cor secundária<input type="color" value={cosmeticDraft.previewSecondary} onChange={(event) => setCosmeticDraft({ ...cosmeticDraft, previewSecondary: event.target.value })} /></label>
                <label>Preço<input type="number" min="0" required value={cosmeticDraft.priceAmount} onChange={(event) => setCosmeticDraft({ ...cosmeticDraft, priceAmount: Number(event.target.value) })} /></label>
                <label>Moeda<select value={cosmeticDraft.priceCurrency} onChange={(event) => setCosmeticDraft({ ...cosmeticDraft, priceCurrency: event.target.value as SpendableCurrency })}><option value="gold">Moedas</option><option value="gems">Gemas</option></select></label>
                <label>Nível mínimo<input type="number" min="1" required value={cosmeticDraft.requiredLevel} onChange={(event) => setCosmeticDraft({ ...cosmeticDraft, requiredLevel: Number(event.target.value) })} /></label>
                <label>Conquista necessária (opcional)<input value={cosmeticDraft.requiredAchievementKey ?? ''} onChange={(event) => setCosmeticDraft({ ...cosmeticDraft, requiredAchievementKey: event.target.value || null })} /></label>
                <label className="check-label"><input type="checkbox" checked={cosmeticDraft.active} onChange={(event) => setCosmeticDraft({ ...cosmeticDraft, active: event.target.checked })} /> Ativo na loja</label>
                <div className="form-actions wide-field"><button className="primary-button" disabled={busy}>{cosmeticDraft.id ? 'Salvar item' : 'Criar item'}</button>{cosmeticDraft.id && <button type="button" className="quiet-button" onClick={() => setCosmeticDraft(emptyCosmetic())}>Cancelar edição</button>}</div>
              </form>
              {cosmetics.length === 0
                ? <AdminEmpty title="Nenhum item cosmético" description="Cadastre itens para disponibilizá-los na loja." />
                : <div className="admin-list">{cosmetics.map((item) => <div className="admin-list-row" key={item.id}>
                <div><strong>{item.name}</strong><small>{item.kind} · {item.price_amount} {currencyLabel(item.price_currency, Number(item.price_amount))} · nível {item.required_level}+ · {item.active ? 'ativo' : 'inativo'}</small></div>
                <div className="row-actions"><button type="button" className="quiet-button" disabled={busy} onClick={() => editCosmetic(item)}>Editar</button>{item.active && <button type="button" className="quiet-button danger-text" disabled={busy} onClick={() => window.confirm(`Desativar ${item.name} na loja?`) && void perform(() => adminApi.deleteCosmetic(item.id), 'Item cosmético desativado.')}>Desativar</button>}</div>
              </div>)}</div>}
            </>
          )}

          {section === 'draws' && (
            <>
              <div className="admin-title-row"><div><p className="eyebrow">ATIVIDADE GLOBAL</p><h2>{historyTab === 'draws' ? 'Histórico de invocações' : historyTab === 'daily' ? 'Resgates diários' : 'Movimentações de carteira'}</h2></div></div>
              <div className={`admin-toolbar history-toolbar ${historyTab === 'wallet' ? 'with-type-filter' : ''}`}>
                <label className="admin-search">
                  <span>Buscar por usuário ou registro</span>
                  <input type="search" aria-label="Buscar registros por usuário ou conteúdo" placeholder="E-mail, carta, recompensa ou tipo" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} />
                </label>
                {historyTab === 'wallet' && <label>Tipo de movimentação<select value={walletHistoryType} onChange={(event) => setWalletHistoryType(event.target.value)}><option value="all">Todos</option>{walletHistoryTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>}
                <label>De<input type="date" value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)} /></label>
                <label>Até<input type="date" value={historyTo} onChange={(event) => setHistoryTo(event.target.value)} /></label>
              </div>
              {historyTab === 'draws' && <>
                <p className="admin-results">{searchedDraws.length} de {draws.length} invocações mais recentes (máximo 200)</p>
                {searchedDraws.length === 0
                  ? <AdminEmpty title={normalizedHistorySearch || historyFrom || historyTo ? 'Nenhuma invocação encontrada' : 'Nenhuma invocação registrada'} description="Ajuste a busca ou o período e tente novamente." />
                  : <div className="admin-list">{searchedDraws.map((draw) => <div className="admin-list-row history-row" key={draw.id}><CardArtwork className="history-card-artwork" imagePath={draw.image_path} alt={`${draw.card_name} — ${draw.rarity_name}`} /><div><strong>{draw.card_name} · {draw.rarity_name}</strong><small>{draw.user_email} · chance efetiva {pct(Number(draw.effective_card_chance))}</small></div><time dateTime={draw.created_at}>{new Date(draw.created_at).toLocaleString('pt-BR')}</time></div>)}</div>}
              </>}
              {historyTab === 'daily' && <>
                <p className="admin-results">{searchedDailyHistory.length} de {dailyHistory.length} resgates mais recentes (máximo 200)</p>
                {searchedDailyHistory.length === 0
                  ? <AdminEmpty title={normalizedHistorySearch || historyFrom || historyTo ? 'Nenhum resgate encontrado' : 'Nenhum resgate registrado'} description="Ajuste a busca ou o período e tente novamente." />
                  : <div className="admin-list">{searchedDailyHistory.map((claim) => <div className="admin-list-row" key={claim.id}>
                    <div><strong>{localizeCurrencyText(claim.reward_name)} · {claim.amount} {currencyLabel(claim.currency, Number(claim.amount))}</strong><small>{claim.user_email} · sequência de {claim.streak_days} dia(s){claim.streak_bonus_name ? ` · bônus: ${localizeCurrencyText(claim.streak_bonus_name)}` : ''}</small></div>
                    <time dateTime={claim.created_at}>{new Date(claim.created_at).toLocaleString('pt-BR')}</time>
                  </div>)}</div>}
              </>}
              {historyTab === 'wallet' && <>
                <p className="admin-results">{searchedWalletHistory.length} de {walletHistory.length} movimentações mais recentes (máximo 200)</p>
                {searchedWalletHistory.length === 0
                  ? <AdminEmpty title={normalizedHistorySearch || historyFrom || historyTo ? 'Nenhuma movimentação encontrada' : 'Nenhuma movimentação registrada'} description="Ajuste a busca ou o período e tente novamente." />
                  : <div className="admin-list">{searchedWalletHistory.map((transaction) => <div className="admin-list-row" key={transaction.id}>
                    <div><strong>{transaction.user_email} · {transaction.type}</strong><small>{Number(transaction.amount).toLocaleString('pt-BR')} {currencyLabel(transaction.currency, Math.abs(Number(transaction.amount)))} · saldo após: {Number(transaction.balance_after).toLocaleString('pt-BR')} · {transaction.reference_type ?? 'sem referência'}</small></div>
                    <time dateTime={transaction.created_at}>{new Date(transaction.created_at).toLocaleString('pt-BR')}</time>
                  </div>)}</div>}
              </>}
            </>
          )}

          {section === 'wallet' && economyTab === 'wallets' && (
            <>
              <div className="admin-title-row"><div><p className="eyebrow">CONCESSÃO E AJUSTES</p><h2>Carteiras</h2></div></div>
              <form className="admin-form" onSubmit={grantCoins}>
                <label className="wide-field">Usuário<select required value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)}><option value="">Selecione uma conta</option>{users.map((user) => <option key={user.id} value={user.id}>{user.email} · {user.balance} {currencyLabel('gold', Number(user.balance))} · {user.gems_balance} {currencyLabel('gems', Number(user.gems_balance))}</option>)}</select></label>
                <label>Moeda<select value={grantCurrency} onChange={(event) => setGrantCurrency(event.target.value as Currency)}><option value="gold">Moedas</option><option value="gems">Gemas</option><option value="xp">XP</option></select></label>
                <label>Valor (negativo para ajuste)<input type="number" required min="-1000000000" max="1000000000" value={grantAmount} onChange={(event) => setGrantAmount(event.target.value)} /></label>
                <label>Motivo<input required maxLength={250} value={grantReason} onChange={(event) => setGrantReason(event.target.value)} /></label>
                <div className="form-actions wide-field"><button className="primary-button" disabled={busy || !selectedUser}>Registrar movimentação</button></div>
              </form>
              <label className="search-field">Filtrar contas<input value={walletSearch} onChange={(event) => setWalletSearch(event.target.value)} placeholder="Buscar por e-mail" /></label>
              <p className="admin-results">{searchedUsers.length} de {users.length} contas</p>
              {searchedUsers.length === 0
                ? <AdminEmpty title="Nenhuma conta encontrada" description={normalizedWalletSearch ? 'Ajuste o e-mail buscado e tente novamente.' : 'Ainda não há contas disponíveis para listar.'} />
                : <div className="admin-list">{searchedUsers.map((user) => <div className="admin-list-row" key={user.id}><div><strong>{user.email}</strong><small>{user.role} · ID {user.id}</small></div><span>{user.balance} {currencyLabel('gold', Number(user.balance))} · {user.gems_balance} {currencyLabel('gems', Number(user.gems_balance))} · {user.xp_balance} XP</span></div>)}</div>}
            </>
          )}

          {section === 'audit' && (
            <>
              <div className="admin-title-row"><div><p className="eyebrow">RASTREABILIDADE</p><h2>Auditoria</h2></div></div>
              <div className="admin-toolbar">
                <label className="admin-search">
                  <span>Buscar registros</span>
                  <input type="search" aria-label="Buscar por ação, entidade ou administrador" placeholder="Ação, entidade ou administrador" value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} />
                </label>
                <span className="admin-results">{searchedLogs.length} de {logs.length} registros recentes</span>
              </div>
              {searchedLogs.length === 0
                ? <AdminEmpty
                  title={normalizedAuditSearch ? 'Nenhum registro encontrado' : 'Nenhuma atividade registrada'}
                  description={normalizedAuditSearch ? 'Ajuste a busca e tente novamente.' : 'As alterações administrativas aparecerão aqui.'}
                />
                : <div className="admin-list">{searchedLogs.map((log) => <div className="admin-list-row" key={log.id}><div><strong>{log.action} · {log.entity_type}</strong><small>{log.actor_email ?? 'Sistema'} · {new Date(log.created_at).toLocaleString('pt-BR')}</small></div><details><summary>Detalhes</summary><pre>{JSON.stringify({ antes: log.before_data, depois: log.after_data }, null, 2)}</pre></details></div>)}</div>}
            </>
          )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return <article className="stat-card">
    <span>{label}</span>
    <strong>{value === null ? '—' : value.toLocaleString('pt-BR')}</strong>
    <small>{detail}</small>
  </article>;
}

function SectionTabs({
  label,
  tabs,
  active,
  onSelect
}: {
  label: string;
  tabs: Array<{ id: string; label: string }>;
  active: string;
  onSelect: (id: string) => void;
}) {
  return <div className="admin-section-tabs" role="group" aria-label={label}>
    {tabs.map((tab) => <button
      type="button"
      key={tab.id}
      className={active === tab.id ? 'active' : ''}
      aria-pressed={active === tab.id}
      onClick={() => onSelect(tab.id)}
    >{tab.label}</button>)}
  </div>;
}

function AdminEmpty({ title, description }: { title: string; description: string }) {
  return <div className="admin-empty" role="status">
    <strong>{title}</strong>
    <p>{description}</p>
  </div>;
}

function pct(value: number): string {
  return `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 6 })}%`;
}


function toLocalDateTimeInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
