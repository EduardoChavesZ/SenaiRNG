export interface User {
  id: string;
  email: string;
  role: 'user' | 'admin';
}

export type Currency = 'gold' | 'gems' | 'xp';
export type SpendableCurrency = Exclude<Currency, 'xp'>;
export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
export type StaticImageMimeType = Exclude<ImageMimeType, 'image/gif'>;

export interface WalletTransaction {
  id: string;
  type: string;
  currency: Currency;
  amount: number;
  balanceAfter: number;
  createdAt: string;
}

export interface CatalogCard {
  id: string;
  name: string;
  rarity_id: string;
  category_id: string | null;
  rarity_sort_order: number;
  image_path: string | null;
  description: string;
  category_name: string | null;
  rarity_name: string;
  color_primary: string;
  color_secondary: string;
  animation_level: number;
}

export interface CollectionCard extends CatalogCard {
  card_id: string;
  quantity: number;
  first_obtained_at: string;
  last_obtained_at: string;
}

export interface DrawOutcome {
  id: string;
  card_id: string;
  card_name: string;
  rarity_id: string;
  rarity_name: string;
  rarity_color_primary: string;
  rarity_color_secondary: string;
  animation_level: number;
  visual_effect: 'glow' | 'particles' | 'reveal' | 'aura';
  image_path: string | null;
  position: number;
  nominal_card_chance: number;
  nominal_rarity_chance: number;
  effective_card_chance: number;
  effective_rarity_chance: number;
  effective_card_numerator?: string | null;
  effective_card_denominator?: string | null;
  is_duplicate?: boolean;
  collection_quantity?: number | null;
  duplicate_gold_amount?: string;
  duplicate_gems_amount?: string;
  duplicate_xp_amount?: string;
  youtube_video_id?: string | null;
  banner_id?: string | null;
  banner_name?: string | null;
  created_at: string;
  unit_cost?: number;
  currency?: SpendableCurrency;
}

export interface DrawOptions {
  unitCost: number;
  originalUnitCost: number;
  currency: SpendableCurrency;
  promotionActive: boolean;
  maxQuantity: number;
  cards: Array<{
    id: string;
    name: string;
    rarityId: string;
    rarityName: string;
    effectiveCardChance: number;
    effectiveRarityChance: number;
    effectiveCardNumerator: string;
    effectiveCardDenominator: string;
    effectiveRarityNumerator: string;
    effectiveRarityDenominator: string;
  }>;
}

export interface InvocationAvailability {
  available: boolean;
  status: 'upcoming' | 'ended' | 'empty_pool' | 'pity_unavailable' | 'available';
  reason: string | null;
}

export interface InvocationBannerSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  imagePath: string | null;
  imageMimeType: ImageMimeType | null;
  imageWidth: number | null;
  imageHeight: number | null;
  fallbackImagePath: string | null;
  imageFocalX: number;
  imageFocalY: number;
  startsAt: string | null;
  endsAt: string | null;
  timeZone: string;
  currency: SpendableCurrency;
  unitCost: number;
  quantityOptions: number[];
  availability: InvocationAvailability;
}

export interface InvocationBannerDetails extends InvocationBannerSummary {
  pity: {
    targetRarityId: string;
    targetRarityName: string;
    failures: number;
    position: number;
    softPityStart: number | null;
    softPityIncrementBps: number;
    hardPityLimit: number | null;
    baseTargetChance: string;
    baseTargetChanceDenominator: string;
    effectiveTargetChance: number;
    effectiveTargetChanceNumerator: string;
    effectiveTargetChanceDenominator: string;
  } | null;
  pool: Array<{
    id: string;
    name: string;
    imagePath: string | null;
    description: string;
    rarityId: string;
    rarityName: string;
    rarityColorPrimary: string;
    rarityColorSecondary: string;
    animationLevel: number;
    youtubeVideoId: string | null;
    effectiveCardChance: number | null;
    effectiveCardNumerator: string | null;
    effectiveCardDenominator: string | null;
  }>;
}

export interface InvocationDrawResult {
  batchId: string;
  bannerId: string | null;
  bannerName: string | null;
  quantity: number;
  unitCost: number;
  totalCost: number;
  balance: number;
  currency: SpendableCurrency;
  wallet: { gold: number; gems: number; xp: number };
  pity: { failures: number; position: number } | null;
  idempotentReplay: boolean;
  draws: DrawOutcome[];
}

export interface CosmeticItem {
  id: string;
  slug: string;
  kind: 'avatar' | 'banner' | 'frame' | 'effect' | 'title';
  name: string;
  description: string;
  previewPrimary: string;
  previewSecondary: string;
  priceAmount: number;
  priceCurrency: SpendableCurrency;
  requiredLevel: number;
  requiredAchievementKey: string | null;
  owned: boolean;
  requirementsMet: boolean;
  canPurchase: boolean;
  canEquip: boolean;
}

export interface ProfileCustomization {
  id: string;
  nickname: string;
  nicknameColor: string;
  description: string;
  colorPrimary: string;
  colorSecondary: string;
  theme: 'light' | 'dark';
  avatarImagePath: string | null;
  bannerImagePath: string | null;
  speechText: string;
  avatarItemId: string | null;
  avatar: { name: string; colorPrimary: string; colorSecondary: string } | null;
  bannerItemId: string | null;
  banner: { name: string; colorPrimary: string; colorSecondary: string } | null;
  frameItemId: string | null;
  frame: { name: string; colorPrimary: string; colorSecondary: string } | null;
  titleItemId: string | null;
  title: string | null;
  featuredCardId: string | null;
  featuredCard: { name: string; imagePath: string | null } | null;
  xp: number;
  level: number;
  stats: { total_draws: string; unique_cards: number; draws_by_rarity: Record<string, number> };
}

export interface UserPreferences {
  reduceEffects: boolean;
  invocationMusicEnabled: boolean;
  soundVolume: number;
}

export interface PublicProfile {
  nickname: string;
  nicknameColor: string;
  description: string;
  colorPrimary: string;
  colorSecondary: string;
  theme: 'light' | 'dark';
  avatarImagePath: string | null;
  bannerImagePath: string | null;
  speechText: string;
  avatar: { name: string; colorPrimary: string; colorSecondary: string } | null;
  banner: { name: string; colorPrimary: string; colorSecondary: string } | null;
  frame: { name: string; colorPrimary: string; colorSecondary: string } | null;
  title: string | null;
  featuredCard: { name: string; imagePath: string | null } | null;
  xp: number;
  level: number;
  stats: { totalDraws: number; uniqueCards: number };
}

export interface DailyReward {
  id: string;
  name: string;
  description: string;
  currency: Currency;
  amount: number;
  weight: number;
  chanceNumerator: string;
  chanceDenominator: string;
  effectiveChance: number;
  colorPrimary: string;
  colorSecondary: string;
}

export interface DailyRewardOptions {
  serverNow: string;
  canClaim: boolean;
  nextAvailableAt: string;
  currentStreak: number;
  bestStreak: number;
  lastClaimDate: string | null;
  level: number;
  wallet: { gold: number; gems: number; xp: number };
  rewards: DailyReward[];
  history: Array<{
    id: string;
    reward_name: string;
    currency: Currency;
    amount: string;
    streak_days: number;
    streak_bonus_name: string | null;
    streak_bonus_currency: Currency | null;
    streak_bonus_amount: string;
    created_at: string;
  }>;
}

export interface DailyRewardClaim {
  id: string;
  reward: { id: string | null; name: string; currency: Currency; amount: number };
  streakDays: number;
  milestone: { name: string; currency: Currency | null; amount: number } | null;
  wallet: { gold: number; gems: number; xp: number };
  nextAvailableAt: string;
  idempotentReplay: boolean;
}

export interface AdminCard {
  id: string;
  name: string;
  image_path: string | null;
  description: string;
  category_id: string | null;
  rarity_id: string;
  weight: string;
  youtube_video_id: string | null;
  youtube_authorized_at: string | null;
  youtube_authorized_by: string | null;
  active: boolean;
  deleted_at: string | null;
  category_name: string | null;
  rarity_name: string;
}

export interface AdminRarity {
  id: string;
  name: string;
  color_primary: string;
  color_secondary: string;
  visual_effect: string;
  animation_level: number;
  sort_order: number;
  weight: string;
  duplicate_tier: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'secret' | null;
  active: boolean;
  deleted_at: string | null;
}

export interface AdminCategory {
  id: string;
  name: string;
  active: boolean;
  deleted_at: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Falha ao comunicar com o servidor.' }));
    throw new Error(body.error ?? 'Falha ao comunicar com o servidor.');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const json = (method: string, value?: unknown): RequestInit => ({
  method,
  body: value === undefined ? undefined : JSON.stringify(value)
});

export const api = {
  me: () => request<{ user: User | null }>('/auth/me'),
  loginConfig: () => request<{ musicVideoId: string | null }>('/auth/login-config'),
  login: (email: string, password: string) =>
    request<{ user: User }>('/auth/login', json('POST', { email, password })),
  register: (email: string, password: string) =>
    request<{ user: User }>('/auth/register', json('POST', { email, password })),
  logout: () => request<void>('/auth/logout', json('POST')),
  wallet: () => request<{ balance: number; gold: number; gems: number; xp: number; lastDailyClaimAt: string | null }>('/wallet'),
  transactions: () => request<{ transactions: WalletTransaction[] }>('/wallet/transactions'),
  catalog: () => request<{ cards: CatalogCard[] }>('/catalog'),
  rarityCatalog: () => request<{ rarities: Array<{ id: string; name: string; active: boolean; deleted_at: string | null }> }>('/catalog/rarities'),
  probabilities: () => request<{ cards: Array<{
    id: string; name: string; rarityId: string; rarityName: string; nominalCardChance: number;
    nominalRarityChance: number; effectiveCardChance: number; effectiveRarityChance: number;
    effectiveCardNumerator: string; effectiveCardDenominator: string;
    effectiveRarityNumerator: string; effectiveRarityDenominator: string;
  }> }>('/catalog/probabilities'),
  drawOptions: () => request<DrawOptions>('/draws/options'),
  invocationBanners: () => request<{ banners: InvocationBannerSummary[] }>('/invocation/banners'),
  invocationBanner: (id: string) => request<{ banner: InvocationBannerDetails }>(`/invocation/banners/${id}`),
  invocationPity: (id: string) => request<{ pity: InvocationBannerDetails['pity'] }>(`/invocation/banners/${id}/pity`),
  draw: (bannerId: string, quantity: number, idempotencyKey: string) =>
    request<InvocationDrawResult>('/draws', json('POST', { bannerId, quantity, idempotencyKey })),
  invocationOperation: (idempotencyKey: string) =>
    request<InvocationDrawResult>(`/draws/operations/${idempotencyKey}`),
  history: (query = '') => request<{ draws: DrawOutcome[] }>(`/draws/history${query}`),
  collection: () => request<{ cards: CollectionCard[] }>('/draws/collection'),
  dailyRewardOptions: () => request<DailyRewardOptions>('/daily-rewards/options'),
  claimDailyReward: (idempotencyKey: string) =>
    request<DailyRewardClaim>('/daily-rewards/claim', json('POST', { idempotencyKey })),
  profile: () => request<{
    profile: ProfileCustomization;
    preferences: UserPreferences;
    cosmetics: CosmeticItem[];
    cards: Array<{ card_id: string; name: string; image_path: string | null; rarity_name: string; quantity: number }>;
    achievements: Array<{ key: string; name: string; description: string; unlocked_at: string }>;
  }>('/profiles/me'),
  updatePreferences: (data: Partial<UserPreferences>) =>
    request<{ preferences: UserPreferences }>('/profiles/preferences', json('PUT', data)),
  updateProfile: (data: {
    nickname: string;
    nicknameColor: string;
    description: string;
    colorPrimary: string;
    colorSecondary: string;
    theme: 'light' | 'dark';
    avatarImagePath: string | null;
    bannerImagePath: string | null;
    speechText: string;
    avatarItemId: string | null;
    bannerItemId: string | null;
    frameItemId: string | null;
    titleItemId: string | null;
    featuredCardId: string | null;
  }) => request<{ profile: ProfileCustomization }>('/profiles/me', json('PUT', data)),
  uploadProfileImage: (file: File, kind: 'avatar' | 'banner') => {
    const form = new FormData();
    form.append('image', file);
    return request<{ kind: 'avatar' | 'banner'; imagePath: string }>(
      `/profiles/images/${kind}`, { method: 'POST', body: form }
    );
  },
  purchaseCosmetic: (id: string, idempotencyKey: string) =>
    request<{ itemId: string; idempotentReplay: boolean }>(
      `/profiles/cosmetics/${id}/purchase`, json('POST', { idempotencyKey })
    ),
  publicProfile: (nickname: string) =>
    request<{ profile: PublicProfile }>(`/profiles/public/${encodeURIComponent(nickname)}`),
  rankings: (metric: 'cards' | 'gold' | 'level' = 'cards') =>
    request<{ metric: 'cards' | 'gold' | 'level'; rankings: Array<{ nickname: string; nicknameColor: string; xp: number; gold: number; level: number; cards: number; rank: number }> }>(
      `/profiles/rankings?metric=${metric}`
    )
};

export const adminApi = {
  overview: () => request<{ users: number; cards: { total: number; active: number }; draws: number }>('/admin/overview'),
  cards: () => request<{ cards: AdminCard[] }>('/admin/cards'),
  rarities: () => request<{ rarities: AdminRarity[] }>('/admin/rarities'),
  categories: () => request<{ categories: AdminCategory[] }>('/admin/categories'),
  settings: () => request<{ settings: AdminSettings }>('/admin/settings'),
  probabilities: () => request<{ mode: string; rarityCardSelection: string; cards: Array<{
    id: string; name: string; rarity_id: string; rarity_name: string; nominalCardChance: number;
    nominalRarityChance: number; effectiveCardChance: number; effectiveRarityChance: number;
    nominalCardNumerator: string; nominalCardDenominator: string;
    effectiveCardNumerator: string; effectiveCardDenominator: string;
    effectiveRarityNumerator: string; effectiveRarityDenominator: string;
    available: boolean; card_weight: string;
  }> }>('/admin/probabilities'),
  logs: () => request<{ logs: Array<Record<string, unknown> & { id: string; actor_email: string | null; action: string; entity_type: string; created_at: string }> }>('/admin/audit-logs'),
  draws: () => request<{ draws: Array<DrawOutcome & { user_email: string }> }>('/admin/draws'),
  dailyHistory: () => request<{ claims: Array<{
    id: string;
    user_id: string;
    user_email: string;
    claim_date: string;
    reward_name: string;
    currency: Currency;
    amount: string;
    streak_days: number;
    streak_bonus_name: string | null;
    streak_bonus_currency: Currency | null;
    streak_bonus_amount: string;
    created_at: string;
  }> }>('/admin/daily-history'),
  walletHistory: () => request<{ transactions: Array<{
    id: string;
    user_id: string;
    user_email: string;
    type: string;
    currency: Currency;
    amount: string;
    balance_after: string;
    reference_type: string | null;
    reference_id: string | null;
    created_at: string;
  }> }>('/admin/wallet-history'),
  users: () => request<{ users: Array<{ id: string; email: string; role: string; balance: string; gems_balance: string; xp_balance: string }> }>('/admin/users'),
  createRarity: (data: unknown) => request('/admin/rarities', json('POST', data)),
  updateRarity: (id: string, data: unknown) => request(`/admin/rarities/${id}`, json('PUT', data)),
  deleteRarity: (id: string) => request<void>(`/admin/rarities/${id}`, json('DELETE')),
  createCategory: (data: unknown) => request<{ category: AdminCategory }>('/admin/categories', json('POST', data)),
  updateCategory: (id: string, data: unknown) => request(`/admin/categories/${id}`, json('PUT', data)),
  deleteCategory: (id: string) => request<void>(`/admin/categories/${id}`, json('DELETE')),
  createCard: (data: unknown) => request('/admin/cards', json('POST', data)),
  updateCard: (id: string, data: unknown) => request(`/admin/cards/${id}`, json('PUT', data)),
  updateCardWeight: (id: string, weight: number) => request(`/admin/cards/${id}/weight`, json('PUT', { weight })),
  deleteCard: (id: string) => request<void>(`/admin/cards/${id}`, json('DELETE')),
  updateSettings: (data: unknown) => request('/admin/settings', json('PUT', data)),
  adjustWallet: (id: string, amount: number, currency: Currency, reason: string) =>
    request(`/admin/users/${id}/wallet`, json('POST', { amount, currency, reason })),
  dailyRewards: () => request<{
    rewards: AdminDailyReward[];
    milestones: AdminStreakMilestone[];
  }>('/admin/daily-rewards'),
  invocationBanners: () => request<{
    banners: AdminInvocationBanner[];
    duplicateRewards: AdminDuplicateReward[];
  }>('/admin/invocation/banners'),
  createInvocationBanner: (data: InvocationBannerInput) =>
    request<{ banner: AdminInvocationBanner }>('/admin/invocation/banners', json('POST', data)),
  previewInvocationBanner: (data: Pick<InvocationBannerInput, 'distributionMode' | 'rarityCardSelection' | 'pool' | 'pity'>) =>
    request<{
      cards: Array<{
        id: string;
        name: string;
        imagePath: string | null;
        rarityName: string;
        available: boolean;
        nominalCardChance: number;
        effectiveCardChance: number;
        pityCardChance: number | null;
      }>;
      missingCardIds: string[];
      pity: {
        configured: boolean;
        targetRarityName: string | null;
        position: number;
        baseTargetChance: number;
        targetChance: number;
        impossible: boolean;
      };
    }>('/admin/invocation/banners/preview', json('POST', data)),
  updateInvocationBanner: (id: string, data: InvocationBannerInput & { version: number }) =>
    request<{ banner: AdminInvocationBanner }>(`/admin/invocation/banners/${id}`, json('PUT', data)),
  updateDuplicateRewards: (data: {
    rarityDefaults: AdminDuplicateRewardInput[];
    cardOverrides: AdminDuplicateRewardInput[];
  }) => request<{ duplicateRewards: AdminDuplicateReward[] }>(
    '/admin/invocation/duplicate-rewards', json('PUT', data)
  ),
  updateDailyRewards: (rewards: unknown) => request('/admin/daily-rewards', json('PUT', rewards)),
  updateDailyStreaks: (milestones: unknown) => request('/admin/daily-streaks', json('PUT', milestones)),
  cosmetics: () => request<{ cosmetics: AdminCosmetic[] }>('/admin/cosmetics'),
  createCosmetic: (data: unknown) => request('/admin/cosmetics', json('POST', data)),
  updateCosmetic: (id: string, data: unknown) => request(`/admin/cosmetics/${id}`, json('PUT', data)),
  deleteCosmetic: (id: string) => request<void>(`/admin/cosmetics/${id}`, json('DELETE')),
  upload: (file: File) => {
    const form = new FormData();
    form.append('image', file);
    return request<{
      imagePath: string;
      mimeType: StaticImageMimeType;
      width: number;
      height: number;
      bytes: number;
    }>('/admin/uploads', { method: 'POST', body: form });
  },
  uploadBannerImage: (file: File) => {
    const form = new FormData();
    form.append('image', file);
    return request<{
      imagePath: string;
      mimeType: ImageMimeType;
      width: number;
      height: number;
      bytes: number;
      frames: number;
      durationMs: number;
    }>('/admin/invocation/banners/uploads', { method: 'POST', body: form });
  }
};

export interface InvocationBannerInput {
  slug: string;
  name: string;
  description: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  timeZone: string;
  currency: SpendableCurrency;
  unitCost: number;
  imagePath: string | null;
  imageMimeType: ImageMimeType | null;
  imageWidth: number | null;
  imageHeight: number | null;
  fallbackImagePath: string | null;
  fallbackImageMimeType: StaticImageMimeType | null;
  fallbackImageWidth: number | null;
  fallbackImageHeight: number | null;
  imageFocalX: number;
  imageFocalY: number;
  quantityOptions: number[];
  distributionMode: 'individual' | 'rarity';
  rarityCardSelection: 'equal' | 'weighted';
  pool: Array<{ cardId: string; weight: number; active: boolean }>;
  pity: {
    rarityId: string;
    softPityStart: number | null;
    softPityIncrementBps: number;
    hardPityLimit: number | null;
  } | null;
}

export interface AdminInvocationBanner extends InvocationBannerInput {
  id: string;
  version: number;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminDuplicateReward {
  id: string;
  rarityId: string;
  cardId: string | null;
  goldAmount: string;
  gemsAmount: string;
  xpAmount: string;
}

export type AdminDuplicateRewardInput = {
  rarityId: string;
  cardId: string | null;
  goldAmount: number;
  gemsAmount: number;
  xpAmount: number;
};

export interface AdminSettings {
  drawCostGold: number;
  drawCostGems: number;
  drawCurrency: SpendableCurrency;
  drawEventEnabled: boolean;
  drawEventDiscountPercent: number;
  drawEventStartsAt: string | null;
  drawEventEndsAt: string | null;
  signupBonus: number;
  xpPerDraw: number;
  distributionMode: 'individual' | 'rarity';
  rarityCardSelection: 'equal' | 'weighted';
  drawMaxQuantity: number;
  loginMusicUrl: string;
  loginMusicRightsConfirmed: boolean;
}

export interface AdminCosmetic {
  id: string;
  slug: string;
  kind: CosmeticItem['kind'];
  name: string;
  description: string;
  preview_primary: string;
  preview_secondary: string;
  price_amount: string;
  price_currency: SpendableCurrency;
  required_level: number;
  required_achievement_key: string | null;
  active: boolean;
}

export interface AdminDailyReward {
  id: string;
  name: string;
  description: string;
  currency: Currency;
  amount: string;
  weight: string;
  color_primary: string;
  color_secondary: string;
  active: boolean;
  sort_order: number;
}

export interface AdminStreakMilestone {
  consecutive_days: number;
  name: string;
  currency: Currency;
  amount: string;
  active: boolean;
}
