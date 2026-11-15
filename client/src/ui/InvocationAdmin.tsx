import { useEffect, useRef, useState } from 'react';
import {
  adminApi,
  type AdminCard,
  type AdminDuplicateRewardInput,
  type AdminInvocationBanner,
  type ImageMimeType,
  type AdminRarity,
  type StaticImageMimeType,
  type InvocationBannerInput
} from '../api';
import { BannerArtwork } from './BannerArtwork';
import { CardArtwork } from './CardArtwork';

type Props = { cards: AdminCard[]; rarities: AdminRarity[]; mode?: 'banner' | 'conversions' };
type PoolDraft = InvocationBannerInput['pool'][number];
type RewardDraft = {
  rarityId: string;
  cardId: string | null;
  goldAmount: string;
  gemsAmount: string;
  xpAmount: string;
};
type BannerDraft = Omit<InvocationBannerInput, 'startsAt' | 'endsAt'> & {
  id?: string;
  version?: number;
  startsAt: string;
  endsAt: string;
};

const emptyBanner = (): BannerDraft => ({
  slug: '',
  name: '',
  description: '',
  active: false,
  startsAt: '',
  endsAt: '',
  timeZone: 'America/Sao_Paulo',
  currency: 'gold',
  unitCost: 10,
  quantityOptions: [1, 10],
  imagePath: null,
  imageMimeType: null,
  imageWidth: null,
  imageHeight: null,
  fallbackImagePath: null,
  fallbackImageMimeType: null,
  fallbackImageWidth: null,
  fallbackImageHeight: null,
  imageFocalX: 50,
  imageFocalY: 50,
  distributionMode: 'individual',
  rarityCardSelection: 'equal',
  pool: [],
  pity: null
});

export function InvocationAdmin({ cards, rarities, mode = 'banner' }: Props) {
  const [banners, setBanners] = useState<AdminInvocationBanner[]>([]);
  const [defaultRewardDrafts, setDefaultRewardDrafts] = useState<RewardDraft[]>([]);
  const [cardRewardDrafts, setCardRewardDrafts] = useState<RewardDraft[]>([]);
  const [draft, setDraft] = useState<BannerDraft>(emptyBanner());
  const [bannerImageFile, setBannerImageFile] = useState<File | null>(null);
  const [fallbackImageFile, setFallbackImageFile] = useState<File | null>(null);
  const bannerImagePreview = useObjectUrl(bannerImageFile);
  const fallbackImagePreview = useObjectUrl(fallbackImageFile);
  const [newQuantity, setNewQuantity] = useState('');
  const [poolSearch, setPoolSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [step, setStep] = useState<'details' | 'pool' | 'review'>('details');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof adminApi.previewInvocationBanner>> | null>(null);
  const [previewKey, setPreviewKey] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const bannerImageInputRef = useRef<HTMLInputElement>(null);
  const fallbackImageInputRef = useRef<HTMLInputElement>(null);
  const currentPreviewKey = JSON.stringify({
    distributionMode: draft.distributionMode,
    rarityCardSelection: draft.rarityCardSelection,
    pool: draft.pool,
    pity: draft.pity
  });

  async function load() {
    setError('');
    const result = await adminApi.invocationBanners();
    setBanners(result.banners);
    setDefaultRewardDrafts(result.duplicateRewards.filter((reward) => !reward.cardId).map(toRewardDraft));
    setCardRewardDrafts(result.duplicateRewards.filter((reward) => reward.cardId).map(toRewardDraft));
  }

  useEffect(() => {
    let active = true;
    void adminApi.invocationBanners()
      .then((result) => {
        if (!active) return;
        setBanners(result.banners);
        setDefaultRewardDrafts(result.duplicateRewards.filter((reward) => !reward.cardId).map(toRewardDraft));
        setCardRewardDrafts(result.duplicateRewards.filter((reward) => reward.cardId).map(toRewardDraft));
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a configuração de invocação.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  function clearImageSelection() {
    setBannerImageFile(null);
    setFallbackImageFile(null);
    if (bannerImageInputRef.current) bannerImageInputRef.current.value = '';
    if (fallbackImageInputRef.current) fallbackImageInputRef.current.value = '';
  }

  function editBanner(banner: AdminInvocationBanner) {
    clearImageSelection();
    setDraft({
      ...banner,
      startsAt: toLocalDateTime(banner.startsAt, banner.timeZone),
      endsAt: toLocalDateTime(banner.endsAt, banner.timeZone),
      pool: banner.pool.map((entry) => ({ ...entry })),
      quantityOptions: [...banner.quantityOptions],
      pity: banner.pity ? { ...banner.pity } : null
    });
    setNewQuantity('');
    setStep('details');
    setPreview(null);
    setPreviewKey('');
    setError('');
    setNotice('');
  }

  async function saveBanner(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let mediaDraft = { ...draft };
      if (bannerImageFile) {
        const uploaded = await adminApi.uploadBannerImage(bannerImageFile);
        mediaDraft = {
          ...mediaDraft,
          imagePath: uploaded.imagePath,
          imageMimeType: uploaded.mimeType,
          imageWidth: uploaded.width,
          imageHeight: uploaded.height
        };
      }
      if (fallbackImageFile) {
        if (!staticImageMimeTypeFromBrowser(fallbackImageFile.type)) {
          throw new Error('O fallback deve ser uma imagem estática PNG, JPG ou WebP.');
        }
        const uploaded = await adminApi.uploadBannerImage(fallbackImageFile);
        if (uploaded.mimeType === 'image/gif') {
          throw new Error('O fallback deve ser uma imagem estática PNG, JPG ou WebP.');
        }
        mediaDraft = {
          ...mediaDraft,
          fallbackImagePath: uploaded.imagePath,
          fallbackImageMimeType: uploaded.mimeType,
          fallbackImageWidth: uploaded.width,
          fallbackImageHeight: uploaded.height
        };
      }
      if (mediaDraft.imageMimeType === 'image/gif' && !mediaDraft.fallbackImagePath) {
        throw new Error('Selecione uma imagem estática de fallback para o GIF.');
      }
      const { id, version, ...data } = mediaDraft;
      const payload: InvocationBannerInput = {
        ...data,
        startsAt: fromLocalDateTime(data.startsAt, data.timeZone),
        endsAt: fromLocalDateTime(data.endsAt, data.timeZone),
        pool: data.pool,
        quantityOptions: [...new Set(data.quantityOptions)].sort((a, b) => a - b)
      };
      const result = id
        ? await adminApi.updateInvocationBanner(id, { ...payload, version: version! })
        : await adminApi.createInvocationBanner(payload);
      await load();
      editBanner(result.banner);
      setNotice(result.banner.active ? 'Banner salvo e publicado.' : 'Configuração do banner salva como rascunho.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o banner.');
    } finally {
      setBusy(false);
    }
  }

  function advanceStep(next: 'pool' | 'review') {
    if (!formRef.current?.reportValidity()) return;
    setStep(next);
  }

  async function loadPreview() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await adminApi.previewInvocationBanner({
        distributionMode: draft.distributionMode,
        rarityCardSelection: draft.rarityCardSelection,
        pool: draft.pool,
        pity: draft.pity
      });
      setPreview(result);
      setPreviewKey(currentPreviewKey);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível calcular as probabilidades do banner.');
    } finally {
      setBusy(false);
    }
  }

  async function saveRewards() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await adminApi.updateDuplicateRewards({
        rarityDefaults: defaultRewardDrafts.map(toRewardInput).filter(hasReward),
        cardOverrides: cardRewardDrafts.map(toRewardInput).filter(hasReward)
      });
      await load();
      setNotice('Conversões de duplicatas salvas.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar as conversões.');
    } finally {
      setBusy(false);
    }
  }

  function rewardInputs(cardSpecific: boolean): RewardDraft[] {
    return cardSpecific ? cardRewardDrafts : defaultRewardDrafts;
  }

  function updateReward(
    cardSpecific: boolean,
    rarityId: string,
    cardId: string | null,
    key: 'goldAmount' | 'gemsAmount' | 'xpAmount',
    value: string
  ) {
    const updated = [...rewardInputs(cardSpecific)];
    const index = updated.findIndex((entry) => entry.rarityId === rarityId && entry.cardId === cardId);
    if (index < 0) {
      updated.push({ rarityId, cardId, goldAmount: '', gemsAmount: '', xpAmount: '', [key]: value });
    } else {
      updated[index] = { ...updated[index]!, [key]: value };
    }
    if (cardSpecific) setCardRewardDrafts(updated);
    else setDefaultRewardDrafts(updated);
  }

  function selectedPool(cardId: string): PoolDraft | undefined {
    return draft.pool.find((entry) => entry.cardId === cardId);
  }

  function togglePoolCard(card: AdminCard, active: boolean) {
    const existing = selectedPool(card.id);
    if (existing) {
      setDraft({
        ...draft,
        pool: draft.pool.map((entry) => entry.cardId === card.id ? { ...entry, active } : entry)
      });
    } else {
      setDraft({
        ...draft,
        pool: [...draft.pool, { cardId: card.id, weight: Math.max(1, Number(card.weight) || 1), active }]
      });
    }
  }

  function setPityEnabled(enabled: boolean) {
    setDraft({
      ...draft,
      pity: enabled
        ? {
          rarityId: rarities.find((rarity) => rarity.active && !rarity.deleted_at)?.id ?? '',
          softPityStart: null,
          softPityIncrementBps: 0,
          hardPityLimit: null
        }
        : null
    });
  }

  const activeRarities = rarities.filter((rarity) => rarity.active && !rarity.deleted_at);
  const configuredRarities = new Set(defaultRewardDrafts.filter(hasReward).map((entry) => entry.rarityId));
  const parsedQuantity = Number(newQuantity);
  const canAddQuantity = newQuantity !== ''
    && Number.isInteger(parsedQuantity)
    && parsedQuantity >= 2
    && parsedQuantity <= 9
    && !draft.quantityOptions.includes(parsedQuantity);
  const searchedPoolCards = cards.filter((card) =>
    !card.deleted_at
    && `${card.name} ${card.rarity_name}`.toLowerCase().includes(poolSearch.trim().toLowerCase())
  );
  const bannerPreview = {
    ...draft,
    imagePath: bannerImagePreview || draft.imagePath,
    imageMimeType: bannerImageFile ? imageMimeTypeFromBrowser(bannerImageFile.type) : draft.imageMimeType,
    fallbackImagePath: fallbackImagePreview || draft.fallbackImagePath
  };

  return <div className="invocation-admin">
    {error && <p className="message error" role="alert">{error}</p>}
    {notice && <p className="message success" role="status">{notice}</p>}
    {mode === 'banner' && <>
      <div className="admin-title-row"><div><p className="eyebrow">BANNERS E POOLS</p><h2>{draft.id ? 'Editar banner' : 'Novo banner'}</h2></div></div>
      <p className="admin-note">Configure o banner em três etapas. A prévia usa as mesmas regras de cálculo da invocação.</p>
      <div className="invocation-steps" aria-label="Etapas da configuração do banner">
        {([
          ['details', '1. Dados'],
          ['pool', '2. Cartas e pesos'],
          ['review', '3. Probabilidades e publicação']
        ] as const).map(([id, label]) => <button
          type="button"
          key={id}
          className={step === id ? 'active' : ''}
          aria-current={step === id ? 'step' : undefined}
          onClick={() => {
            if (id === 'details') setStep('details');
            else if (id === 'pool') step === 'details' ? advanceStep('pool') : setStep('pool');
            else if (step === 'pool') advanceStep('review');
            else if (step === 'details') advanceStep('pool');
          }}
        >{label}</button>)}
      </div>
      <form ref={formRef} className="admin-form invocation-admin-form" onSubmit={(event) => void saveBanner(event)}>
        {step === 'details' && <>
          <label>Nome do banner<input required maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>Identificador<input required maxLength={80} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} placeholder="banner-inicial" /></label>
          <label className="wide-field">Descrição<textarea rows={2} maxLength={1000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <section className="banner-media-editor wide-field" aria-labelledby="banner-media-title">
            <div>
              <h3 id="banner-media-title">Arte do banner</h3>
              <p>PNG, JPG, WebP ou GIF · até 5 MB · máximo de 4096 px por lado e 16 megapixels. GIF: até 120 quadros e 15 segundos.</p>
            </div>
            <label>Imagem principal do banner
              <span className="image-file-picker">
                <span className="image-file-picker-button">Escolher imagem</span>
                <span className="image-file-picker-name" title={bannerImageFile?.name ?? draft.imagePath?.split('/').pop() ?? ''}>
                  {bannerImageFile?.name ?? draft.imagePath?.split('/').pop() ?? 'Nenhum arquivo selecionado'}
                </span>
                <input
                  ref={bannerImageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    if (!imageMimeTypeFromBrowser(file.type)) {
                      setBannerImageFile(null);
                      setError('Use uma imagem PNG, JPG, WebP ou GIF.');
                      event.currentTarget.value = '';
                    } else if (file.size > 5 * 1024 * 1024) {
                      setBannerImageFile(null);
                      setError('A imagem do banner deve ter no máximo 5 MB.');
                      event.currentTarget.value = '';
                    } else {
                      setError('');
                      setBannerImageFile(file);
                    }
                  }}
                />
              </span>
              <small>O GIF original é preservado. O banner pode permanecer sem mídia.</small>
            </label>
            <label>Imagem estática de fallback {bannerPreview.imageMimeType === 'image/gif' && <span aria-hidden="true">*</span>}
              <span className="image-file-picker">
                <span className="image-file-picker-button">Escolher imagem</span>
                <span className="image-file-picker-name" title={fallbackImageFile?.name ?? draft.fallbackImagePath?.split('/').pop() ?? ''}>
                  {fallbackImageFile?.name ?? draft.fallbackImagePath?.split('/').pop() ?? 'Nenhum arquivo selecionado'}
                </span>
                <input
                  ref={fallbackImageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required={bannerPreview.imageMimeType === 'image/gif' && !bannerPreview.fallbackImagePath}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                      setFallbackImageFile(null);
                      setError('O fallback deve ser uma imagem estática PNG, JPG ou WebP.');
                      event.currentTarget.value = '';
                    } else if (file.size > 5 * 1024 * 1024) {
                      setFallbackImageFile(null);
                      setError('A imagem de fallback deve ter no máximo 5 MB.');
                      event.currentTarget.value = '';
                    } else {
                      setError('');
                      setFallbackImageFile(file);
                    }
                  }}
                />
              </span>
              <small>Obrigatória para GIF; usada com movimento reduzido e ao pausar.</small>
            </label>
            {(bannerImageFile || fallbackImageFile || draft.imagePath) && <div className="banner-media-actions">
              {bannerImageFile && <button type="button" className="quiet-button" disabled={busy} onClick={() => {
                setBannerImageFile(null);
                if (bannerImageInputRef.current) bannerImageInputRef.current.value = '';
              }}>Cancelar substituição da arte</button>}
              {fallbackImageFile && <button type="button" className="quiet-button" disabled={busy} onClick={() => {
                setFallbackImageFile(null);
                if (fallbackImageInputRef.current) fallbackImageInputRef.current.value = '';
              }}>Cancelar substituição do fallback</button>}
              {draft.imagePath && <button
                type="button"
                className="quiet-button danger-text"
                disabled={busy}
                onClick={() => {
                  clearImageSelection();
                  setDraft({
                    ...draft,
                    imagePath: null,
                    imageMimeType: null,
                    imageWidth: null,
                    imageHeight: null,
                    fallbackImagePath: null,
                    fallbackImageMimeType: null,
                    fallbackImageWidth: null,
                    fallbackImageHeight: null
                  });
                }}
              >Remover mídia do banner</button>}
              {draft.fallbackImagePath && <button
                type="button"
                className="quiet-button danger-text"
                disabled={busy || (bannerPreview.imageMimeType === 'image/gif' && !fallbackImageFile)}
                onClick={() => setDraft({
                  ...draft,
                  fallbackImagePath: null,
                  fallbackImageMimeType: null,
                  fallbackImageWidth: null,
                  fallbackImageHeight: null
                })}
              >Remover imagem de fallback</button>}
            </div>}
            <fieldset className="banner-focal-controls">
              <legend>Enquadramento da imagem</legend>
              <label>Ponto focal horizontal
                <input type="range" min="0" max="100" value={draft.imageFocalX} onChange={(event) => setDraft({ ...draft, imageFocalX: Number(event.target.value) })} />
              </label>
              <label>Ponto focal vertical
                <input type="range" min="0" max="100" value={draft.imageFocalY} onChange={(event) => setDraft({ ...draft, imageFocalY: Number(event.target.value) })} />
              </label>
            </fieldset>
            <div className="banner-admin-previews">
              <div><h4>Prévia desktop</h4><BannerArtwork banner={bannerPreview} reducedMotion={false} eager /></div>
              <div className="banner-mobile-preview"><h4>Prévia mobile</h4><BannerArtwork banner={bannerPreview} reducedMotion={false} eager /></div>
            </div>
          </section>
          <label>Moeda<select value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value as InvocationBannerInput['currency'] })}><option value="gold">Moedas</option><option value="gems">Gemas</option></select></label>
          <label>Custo por carta<input type="number" min="1" max="1000000000" required value={draft.unitCost} onChange={(event) => setDraft({ ...draft, unitCost: Number(event.target.value) })} /></label>
          <label>Fuso horário<input required maxLength={100} value={draft.timeZone} onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })} placeholder="America/Sao_Paulo" /></label>
          <label>Início<input type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} /><small>Horário interpretado no fuso do banner.</small></label>
          <label>Fim<input type="datetime-local" value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} /><small>Horário interpretado no fuso do banner.</small></label>
          <div className="form-actions wide-field"><button type="button" className="primary-button" onClick={() => advanceStep('pool')}>Continuar para as cartas</button></div>
        </>}
        {step === 'pool' && <>
          <label>Distribuição<select value={draft.distributionMode} onChange={(event) => setDraft({ ...draft, distributionMode: event.target.value as InvocationBannerInput['distributionMode'] })}><option value="individual">Por carta</option><option value="rarity">Por raridade</option></select></label>
          <label>Seleção na raridade<select value={draft.rarityCardSelection} onChange={(event) => setDraft({ ...draft, rarityCardSelection: event.target.value as InvocationBannerInput['rarityCardSelection'] })}><option value="equal">Igual entre cartas</option><option value="weighted">Ponderada pelo peso da carta</option></select></label>
          <fieldset className="wide-field invocation-pool-editor"><legend>Cartas do pool</legend>
            <label className="admin-search"><span>Buscar por carta ou raridade</span><input type="search" value={poolSearch} onChange={(event) => setPoolSearch(event.target.value)} /></label>
            <p className="admin-note">{draft.pool.filter((entry) => entry.active).length} cartas selecionadas</p>
            <div className="invocation-admin-pool">{searchedPoolCards.map((card) => {
              const poolEntry = selectedPool(card.id);
              return <div className="invocation-admin-pool-row" key={card.id}>
                <CardArtwork className="invocation-admin-pool-thumb" imagePath={card.image_path} alt={`${card.name} — ${card.rarity_name}`} />
                <label className="check-label"><input type="checkbox" checked={Boolean(poolEntry?.active)} onChange={(event) => togglePoolCard(card, event.target.checked)} />
                  <span>{card.name}<small>{card.rarity_name} · {card.active ? 'ativa' : 'inativa'}</small></span>
                </label>
                <label>Peso<input type="number" min="1" max="9000000000000000" disabled={!poolEntry?.active} value={poolEntry?.weight ?? ''} onChange={(event) => setDraft({
                  ...draft,
                  pool: draft.pool.map((entry) => entry.cardId === card.id ? { ...entry, weight: Number(event.target.value) } : entry)
                })} /></label>
              </div>;
            })}</div>
          </fieldset>
          <div className="form-actions wide-field"><button type="button" className="quiet-button" onClick={() => setStep('details')}>Voltar</button><button type="button" className="primary-button" onClick={() => advanceStep('review')}>Continuar para probabilidades</button></div>
        </>}
        {step === 'review' && <>
          <fieldset className="wide-field invocation-quantities"><legend>Quantidades disponíveis (1x e 10x obrigatórias)</legend>
            {[...draft.quantityOptions].sort((a, b) => a - b).map((quantity) => <label className="check-label" key={quantity}>
              <input type="checkbox" checked onChange={() => setDraft({ ...draft, quantityOptions: draft.quantityOptions.filter((option) => option !== quantity) })} disabled={quantity === 1 || quantity === 10} />
              {quantity}x
            </label>)}
            <input aria-label="Nova quantidade de invocação" type="number" min="2" max="9" value={newQuantity} onChange={(event) => setNewQuantity(event.target.value)} />
            <button type="button" className="secondary-button" disabled={!canAddQuantity || busy} onClick={() => {
              setDraft({ ...draft, quantityOptions: [...draft.quantityOptions, parsedQuantity] });
              setNewQuantity('');
            }}>Adicionar</button>
          </fieldset>
          <fieldset className="wide-field invocation-pity-config"><legend>Garantia (pity)</legend>
            <label className="check-label"><input type="checkbox" checked={Boolean(draft.pity)} onChange={(event) => setPityEnabled(event.target.checked)} /> Ativar pity independente por banner</label>
            {draft.pity && <>
              <label>Raridade-alvo<select required value={draft.pity.rarityId} onChange={(event) => setDraft({ ...draft, pity: draft.pity ? { ...draft.pity, rarityId: event.target.value } : null })}>
                <option value="">Selecione</option>{activeRarities.map((rarity) => <option key={rarity.id} value={rarity.id}>{rarity.name}</option>)}
              </select></label>
              <label>Início do soft pity<input type="number" min="1" max="32767" value={draft.pity.softPityStart ?? ''} onChange={(event) => setDraft({ ...draft, pity: draft.pity ? {
                ...draft.pity,
                softPityStart: event.target.value === '' ? null : Number(event.target.value),
                softPityIncrementBps: event.target.value === '' ? 0 : draft.pity.softPityIncrementBps
              } : null })} /></label>
              <label>Incremento por falha (pontos-base)<input type="number" min="0" max="10000" value={draft.pity.softPityIncrementBps} onChange={(event) => setDraft({ ...draft, pity: draft.pity ? { ...draft.pity, softPityIncrementBps: Number(event.target.value) } : null })} /></label>
              <label>Hard pity<input type="number" min="1" max="32767" value={draft.pity.hardPityLimit ?? ''} onChange={(event) => setDraft({ ...draft, pity: draft.pity ? { ...draft.pity, hardPityLimit: event.target.value === '' ? null : Number(event.target.value) } : null })} /></label>
              <small className="admin-note">A prévia considera a posição 1. O progresso real é individual por usuário e banner.</small>
            </>}
          </fieldset>
          <div className="invocation-preview wide-field">
            <div className="admin-title-row"><div><p className="eyebrow">CÁLCULO DO SERVIDOR</p><h3>Prévia do banner</h3></div><button type="button" className="secondary-button" disabled={busy} onClick={() => void loadPreview()}>{busy ? 'Calculando...' : 'Calcular probabilidades'}</button></div>
            {preview && previewKey === currentPreviewKey && <>
              {preview.missingCardIds.length > 0 && <p className="message error" role="alert">Algumas cartas selecionadas não existem mais no catálogo.</p>}
              {draft.pity && <p className={preview.pity.impossible ? 'message error' : 'admin-note'} role={preview.pity.impossible ? 'alert' : undefined}>
                {preview.pity.targetRarityName}: chance-base {formatPercent(preview.pity.baseTargetChance)} · na posição {preview.pity.position}: {formatPercent(preview.pity.targetChance)}
                {preview.pity.impossible ? ' · não há carta elegível para esta garantia.' : ''}
              </p>}
              {preview.cards.length === 0
                ? <p className="admin-note">Selecione cartas para calcular a distribuição.</p>
                : <div className="admin-list">{preview.cards.map((card) => <div className="admin-list-row" key={card.id}>
                  <CardArtwork className="admin-card-thumb" imagePath={card.imagePath} alt={card.name} />
                  <div><strong>{card.name}</strong><small>{card.rarityName} · {card.available ? 'disponível' : 'indisponível'}</small></div>
                  <span>{card.available ? formatPercent(draft.pity ? card.pityCardChance ?? 0 : card.effectiveCardChance) : '0%'}</span>
                </div>)}</div>}
            </>}
            {(!preview || previewKey !== currentPreviewKey) && <p className="admin-note">A prévia fica desatualizada quando pool, pesos ou pity mudam. Recalcule antes de publicar.</p>}
          </div>
          <label className="check-label"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Publicar banner ao salvar</label>
          <div className="form-actions wide-field">
            <button type="button" className="quiet-button" onClick={() => setStep('pool')}>Voltar</button>
            <button type="submit" className="primary-button" disabled={busy || loading || cards.length === 0 || rarities.length === 0}>{busy ? 'Enviando mídia e salvando...' : draft.id ? 'Salvar banner' : 'Criar banner'}</button>
            {draft.id && <button type="button" className="quiet-button" onClick={() => {
              clearImageSelection();
              setDraft(emptyBanner());
              setStep('details');
              setPreview(null);
              setPreviewKey('');
            }}>Novo banner</button>}
          </div>
        </>}
      </form>

      <div className="admin-list invocation-admin-banners">
        <h3>Banners cadastrados</h3>
        {loading ? <p className="admin-note">Carregando banners...</p> : banners.length === 0
          ? <p className="admin-note">Nenhum banner cadastrado.</p>
          : banners.map((banner) => <div className="invocation-admin-banner-card" key={banner.id}>
            <BannerArtwork banner={banner} reducedMotion eager={false} className="invocation-admin-banner-artwork" />
            <div><strong>{banner.name}</strong><small>{banner.slug} · {banner.active ? 'publicado' : 'rascunho'} · {banner.pool.filter((entry) => entry.active).length} cartas · versão {banner.version}</small></div>
            <button type="button" className="quiet-button" onClick={() => editBanner(banner)}>Editar</button>
          </div>)}
      </div>
    </>}

    {mode === 'conversions' && <section className="invocation-conversions">
      <div className="admin-title-row"><div><p className="eyebrow">ECONOMIA DE DUPLICATAS</p><h2>Conversões</h2></div></div>
      <p className="admin-note">Não existem valores padrão inventados. Configure uma conversão para cada raridade usada nos pools ativos; as sobrescritas por carta são opcionais.</p>
      <h3>Conversão padrão por raridade</h3>
      <div className="invocation-conversion-list">            {rarities.filter((rarity) => !rarity.deleted_at).map((rarity) => {
        const reward = defaultRewardDrafts.find((entry) => entry.rarityId === rarity.id);
        return <div className="invocation-conversion-row" key={rarity.id}>
          <strong>{rarity.name}<small>{rarity.duplicate_tier ?? 'Não classificada'}</small></strong>
          {rewardFields(reward, rarity.id, null, (key, value) => updateReward(false, rarity.id, null, key, value))}
          {!configuredRarities.has(rarity.id) && <small className="conversion-missing">Não configurada</small>}
        </div>;
      })}</div>
      <button type="button" className="primary-button" disabled={busy} onClick={() => void saveRewards()}>{busy ? 'Salvando...' : 'Salvar conversões padrão e sobrescritas'}</button>

      <h3>Sobrescritas por carta</h3>
      <div className="invocation-conversion-list">{cards.filter((card) => !card.deleted_at).map((card) => {
        const reward = cardRewardDrafts.find((entry) => entry.cardId === card.id);
        return <div className="invocation-conversion-row" key={card.id}>
          <div className="invocation-conversion-card"><CardArtwork className="admin-card-thumb" imagePath={card.image_path} alt={`${card.name} — ${card.rarity_name}`} /><strong>{card.name}<small>{card.rarity_name}</small></strong></div>
          {reward
            ? <>{rewardFields(reward, reward.rarityId, card.id, (key, value) => updateReward(true, reward.rarityId, card.id, key, value))}
            <button type="button" className="quiet-button danger-text" disabled={busy} onClick={() => setCardRewardDrafts(cardRewardDrafts.filter((entry) => entry.cardId !== card.id))}>Remover sobrescrita</button></>
            : <button type="button" className="quiet-button" disabled={busy} onClick={() => setCardRewardDrafts([
            ...cardRewardDrafts,
            { rarityId: card.rarity_id, cardId: card.id, goldAmount: '', gemsAmount: '', xpAmount: '' }
            ])}>Configurar sobrescrita</button>}
        </div>;
      })}</div>
    </section>}
  </div>;
}

function rewardFields(
  reward: RewardDraft | undefined,
  rarityId: string,
  cardId: string | null,
  onChange: (key: 'goldAmount' | 'gemsAmount' | 'xpAmount', value: string) => void
) {
  return <div className="invocation-reward-fields">
    <label>Moedas<input type="number" min="0" max="1000000000" value={reward?.goldAmount ?? ''} onChange={(event) => onChange('goldAmount', event.target.value)} aria-label={`${rarityId} ${cardId ?? 'padrão'} Moedas`} /></label>
    <label>Gemas<input type="number" min="0" max="1000000000" value={reward?.gemsAmount ?? ''} onChange={(event) => onChange('gemsAmount', event.target.value)} aria-label={`${rarityId} ${cardId ?? 'padrão'} Gemas`} /></label>
    <label>XP<input type="number" min="0" max="1000000000" value={reward?.xpAmount ?? ''} onChange={(event) => onChange('xpAmount', event.target.value)} aria-label={`${rarityId} ${cardId ?? 'padrão'} XP`} /></label>
  </div>;
}

function toRewardInput(reward: RewardDraft): AdminDuplicateRewardInput {
  return {
    rarityId: reward.rarityId,
    cardId: reward.cardId,
    goldAmount: Number(reward.goldAmount),
    gemsAmount: Number(reward.gemsAmount),
    xpAmount: Number(reward.xpAmount)
  };
}

function toRewardDraft(reward: { rarityId: string; cardId: string | null; goldAmount: string; gemsAmount: string; xpAmount: string }): RewardDraft {
  return {
    rarityId: reward.rarityId,
    cardId: reward.cardId,
    goldAmount: reward.goldAmount,
    gemsAmount: reward.gemsAmount,
    xpAmount: reward.xpAmount
  };
}

function hasReward(reward: RewardDraft | AdminDuplicateRewardInput): boolean {
  return Number(reward.goldAmount) > 0 || Number(reward.gemsAmount) > 0 || Number(reward.xpAmount) > 0;
}

function useObjectUrl(file: File | null): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file) {
      setUrl('');
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url;
}

function imageMimeTypeFromBrowser(value: string): ImageMimeType | null {
  switch (value) {
    case 'image/jpeg': return 'image/jpeg';
    case 'image/png': return 'image/png';
    case 'image/webp': return 'image/webp';
    case 'image/gif': return 'image/gif';
    default: return null;
  }
}

function staticImageMimeTypeFromBrowser(value: string): StaticImageMimeType | null {
  const mimeType = imageMimeTypeFromBrowser(value);
  return mimeType === 'image/gif' ? null : mimeType;
}

function formatPercent(value: number): string {
  return `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 6 })}%`;
}

function toLocalDateTime(value: string | null, timeZone: string): string {
  if (!value) return '';
  const date = new Date(value);
  const parts = zonedDateTimeParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function fromLocalDateTime(value: string, timeZone: string): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new Error('Informe uma data e horário válidos.');
  const wanted = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5])
  };
  const wantedUtc = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute);
  let timestamp = wantedUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedDateTimeParts(new Date(timestamp), timeZone);
    const actualUtc = Date.UTC(
      Number(actual.year),
      Number(actual.month) - 1,
      Number(actual.day),
      Number(actual.hour),
      Number(actual.minute)
    );
    const adjustment = actualUtc - wantedUtc;
    timestamp -= adjustment;
    if (adjustment === 0) break;
  }
  const resolved = zonedDateTimeParts(new Date(timestamp), timeZone);
  if (Number(resolved.year) !== wanted.year
    || Number(resolved.month) !== wanted.month
    || Number(resolved.day) !== wanted.day
    || Number(resolved.hour) !== wanted.hour
    || Number(resolved.minute) !== wanted.minute) {
    throw new Error('Esse horário local não existe no fuso selecionado por causa da mudança de horário sazonal.');
  }
  return new Date(timestamp).toISOString();
}

function zonedDateTimeParts(date: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).map((part) => [part.type, part.value]));
}
