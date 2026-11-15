import { useEffect, useState } from 'react';
import { api, type DrawOutcome, type InvocationBannerDetails, type InvocationBannerSummary, type InvocationDrawResult } from '../api';
import { currencyLabel } from '../currency';
import { formatOdds } from '../odds';
import { BannerArtwork } from './BannerArtwork';
import { CardArtwork } from './CardArtwork';

type Wallet = { gold: number; gems: number } | null;

type Props = {
  wallet: Wallet;
  busy: boolean;
  drawStatus: 'idle' | 'waiting';
  latest: InvocationDrawResult | null;
  revealedCount: number;
  onDraw: (bannerId: string, quantity: number) => void;
  onRevealSound: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  volume: number;
  onVolumeChange: (value: number) => void;
  onVolumeCommit: (value: number) => void;
  invocationMusicEnabled: boolean;
  onInvocationMusicEnabledChange: (enabled: boolean) => void;
  reduceEffects: boolean;
  systemReducedMotion: boolean;
  onReduceEffectsChange: (enabled: boolean) => void;
  onSkip: () => void;
};

export function InvocationPage(props: Props) {
  const [banners, setBanners] = useState<InvocationBannerSummary[]>([]);
  const [selectedBannerId, setSelectedBannerId] = useState('');
  const [details, setDetails] = useState<InvocationBannerDetails | null>(null);
  const [loadingBanners, setLoadingBanners] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState('');
  const [activeMusicDrawId, setActiveMusicDrawId] = useState('');
  const [autoplayMusic, setAutoplayMusic] = useState(false);

  useEffect(() => {
    let active = true;
    void api.invocationBanners()
      .then(({ banners: loaded }) => {
        if (!active) return;
        setBanners(loaded);
        const pending = readPendingBannerId();
        const preferred = props.latest?.bannerId ?? pending;
        const selected = loaded.find((banner) => banner.id === preferred)?.id ?? loaded[0]?.id ?? '';
        setSelectedBannerId(selected);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os banners.');
      })
      .finally(() => {
        if (active) setLoadingBanners(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (props.latest?.bannerId && banners.some((banner) => banner.id === props.latest?.bannerId)) {
      setSelectedBannerId(props.latest.bannerId);
    }
  }, [props.latest?.batchId, props.latest?.bannerId, banners]);

  useEffect(() => {
    if (!selectedBannerId) {
      setDetails(null);
      return;
    }
    let active = true;
    setLoadingDetails(true);
    setError('');
    void api.invocationBanner(selectedBannerId)
      .then(({ banner }) => {
        if (active) setDetails(banner);
      })
      .catch((cause: unknown) => {
        if (active) {
          setDetails(null);
          setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o banner.');
        }
      })
      .finally(() => {
        if (active) setLoadingDetails(false);
      });
    return () => { active = false; };
  }, [selectedBannerId, props.latest?.batchId]);

  useEffect(() => {
    if (!props.latest) return;
    const firstMusicResult = props.latest.draws.find((draw) => draw.youtube_video_id);
    if (props.invocationMusicEnabled && firstMusicResult) {
      setActiveMusicDrawId(firstMusicResult.id);
      setAutoplayMusic(true);
    } else {
      setActiveMusicDrawId('');
      setAutoplayMusic(false);
    }
  }, [props.latest?.batchId, props.invocationMusicEnabled]);

  const selectedSummary = banners.find((banner) => banner.id === selectedBannerId) ?? null;
  const currency = details?.currency ?? selectedSummary?.currency ?? 'gold';
  const balance = props.wallet?.[currency] ?? 0;
  const canDraw = Boolean(
    details?.availability.available
    && !props.busy
    && !loadingDetails
    && details.pool.length
  );

  function toggleMusicPreference(enabled: boolean) {
    props.onInvocationMusicEnabledChange(enabled);
    if (!enabled) {
      setActiveMusicDrawId('');
      setAutoplayMusic(false);
      return;
    }
    const firstMusicResult = props.latest?.draws.find((draw) => draw.youtube_video_id);
    if (firstMusicResult) {
      setActiveMusicDrawId(firstMusicResult.id);
      setAutoplayMusic(true);
    }
  }

  return (
    <section className={`page-section draw-page summon-page invocation-page ${props.reduceEffects || props.systemReducedMotion ? 'reduce-effects' : ''}`}>
      {error && <p className="message error" role="alert">{error}</p>}
      <section className="summon-panel" aria-labelledby="summon-title">
        <p className="eyebrow">BANNERS CONFIGURADOS</p>
        <h2 id="summon-title">Invocação</h2>
        {loadingBanners
          ? <p className="summon-message" role="status">Carregando banners...</p>
          : banners.length === 0
            ? <p className="summon-message" role="status">Nenhum banner de invocação está publicado no momento.</p>
            : <>
              <label className="invocation-banner-select">Banner
                <select
                  aria-label="Selecionar banner de invocação"
                  value={selectedBannerId}
                  onChange={(event) => setSelectedBannerId(event.target.value)}
                >
                  {banners.map((banner) => (
                    <option key={banner.id} value={banner.id}>
                      {banner.name}{banner.availability.available ? '' : ` · ${availabilityLabel(banner.availability.status)}`}
                    </option>
                  ))}
                </select>
              </label>
              {selectedSummary && <BannerArtwork
                banner={details ?? selectedSummary}
                reducedMotion={props.reduceEffects || props.systemReducedMotion}
                eager
              />}
              {details && <>
                <div className="invocation-banner-status-line">
                  <span>{details.availability.available ? 'Banner disponível' : availabilityLabel(details.availability.status)}</span>
                </div>
                <div className="invocation-summary">
                  <article><span>Seu saldo</span><strong>{balance.toLocaleString('pt-BR')} {currencyLabel(currency, balance)}</strong></article>
                  <article><span>Custo por carta</span><strong>{details.unitCost.toLocaleString('pt-BR')} {currencyLabel(currency, details.unitCost)}</strong></article>
                  <article><span>Fuso do banner</span><strong>{details.timeZone}</strong></article>
                </div>
                {(details.startsAt || details.endsAt) && <p className="muted invocation-period">
                  Período:{' '}
                  {details.startsAt ? new Date(details.startsAt).toLocaleString('pt-BR', { timeZone: details.timeZone }) : 'sem início definido'}
                  {' — '}
                  {details.endsAt ? new Date(details.endsAt).toLocaleString('pt-BR', { timeZone: details.timeZone }) : 'sem encerramento definido'}
                </p>}
                {details.availability.reason && <p className="message invocation-unavailable" role="status">{details.availability.reason}</p>}
                {details.pity && <div className="invocation-pity" aria-label="Progresso da garantia">
                  <strong>Garantia: {details.pity.targetRarityName} ou superior</strong>
                  <span>{details.pity.failures} falhas · próxima posição {details.pity.position}</span>
                  <small>
                    {details.pity.softPityStart
                      ? `Soft pity desde ${details.pity.softPityStart}ª posição (+${details.pity.softPityIncrementBps} pontos-base por falha)`
                      : 'Sem soft pity'}
                    {details.pity.hardPityLimit ? ` · garantia até a posição ${details.pity.hardPityLimit}` : ''}
                  </small>
                  {details.availability.available && <small>
                    Chance efetiva atual da garantia: {formatOdds(
                      details.pity.effectiveTargetChanceNumerator,
                      details.pity.effectiveTargetChanceDenominator,
                      details.pity.effectiveTargetChance
                    ).percent}
                  </small>}
                </div>}
                <div className="invocation-actions" aria-label="Quantidades disponíveis">
                  {details.quantityOptions.map((quantity) => {
                    const total = details.unitCost * quantity;
                    const affordable = balance >= total;
                    return <button
                      key={quantity}
                      type="button"
                      className="summon-button"
                      disabled={!canDraw || !affordable}
                      onClick={() => props.onDraw(details.id, quantity)}
                    >
                      Invocar {quantity}x · {total.toLocaleString('pt-BR')} {currencyLabel(currency, total)}
                    </button>;
                  })}
                </div>
                {props.drawStatus === 'waiting'
                  ? <p className="summon-message" role="status">Confirmando a invocação com o servidor...</p>
                  : details.availability.available && balance < details.unitCost
                    ? <p className="summon-message" role="status">Saldo insuficiente. Resgate sua recompensa diária.</p>
                    : details.availability.available
                      ? <p className="summon-message" role="status">Resultados, cobrança e probabilidades são confirmados pelo servidor.</p>
                      : null}
                <section className="invocation-pool" aria-labelledby="pool-title">
                  <div className="section-heading compact">
                    <div><p className="eyebrow">POOL ELEGÍVEL</p><h3 id="pool-title">Cartas e probabilidades atuais</h3></div>
                    <span>{details.pool.length}</span>
                  </div>
                  {details.pool.length === 0
                    ? <p className="muted">Nenhuma carta está elegível neste momento.</p>
                    : <div className="invocation-pool-list">{details.pool.map((card) => {
                      const odds = card.effectiveCardNumerator && card.effectiveCardDenominator
                        ? formatOdds(card.effectiveCardNumerator, card.effectiveCardDenominator, card.effectiveCardChance ?? 0)
                        : null;
                      return <article className="invocation-pool-card" key={card.id}>
                        <CardArtwork imagePath={card.imagePath} alt={`${card.name} — ${card.rarityName}`} />
                        <div><strong>{card.name}</strong><small>{card.rarityName}</small></div>
                        <strong className="invocation-pool-odds">{odds?.percent ?? '—'}</strong>
                      </article>;
                    })}</div>}
                </section>
              </>}
            </>}
      </section>

      <div className="draw-preferences">
        <div className="sound-controls">
          <button type="button" className={`quiet-button ${props.soundEnabled ? 'sound-on' : ''}`} onClick={props.onToggleSound} aria-pressed={props.soundEnabled}>
            Som de interface {props.soundEnabled ? 'ativado' : 'desativado'}
          </button>
          <label>Volume do som de interface
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={props.volume}
              disabled={!props.soundEnabled}
              onChange={(event) => props.onVolumeChange(Number(event.target.value))}
              onPointerUp={(event) => props.onVolumeCommit(Number(event.currentTarget.value))}
              onKeyUp={(event) => props.onVolumeCommit(Number(event.currentTarget.value))}
            />
          </label>
          <label className="check-label">
            <input type="checkbox" checked={props.invocationMusicEnabled} onChange={(event) => toggleMusicPreference(event.target.checked)} />
            Música do YouTube nas revelações (desativada por padrão)
          </label>
          <label className="check-label">
            <input type="checkbox" checked={props.reduceEffects} onChange={(event) => props.onReduceEffectsChange(event.target.checked)} />
            Reduzir efeitos
          </label>
        </div>
      </div>

      {props.latest && <section className="reveal-section" aria-live="polite">
        <div className="section-heading">
          <div>
            <p className="eyebrow">RESULTADO · {props.latest.totalCost.toLocaleString('pt-BR')} {currencyLabel(props.latest.currency, props.latest.totalCost).toUpperCase()}</p>
            <h2>Suas cartas · {props.latest.bannerName ?? 'Invocação'}</h2>
          </div>
          {props.revealedCount < props.latest.draws.length && <button className="secondary-button" type="button" onClick={props.onSkip}>Pular animação</button>}
        </div>
        {props.latest.idempotentReplay && <p className="message success" role="status">Resultado anterior recuperado; nenhuma nova cobrança foi feita.</p>}
        <div className="reveal-grid">
          {props.latest.draws.slice(0, props.revealedCount).map((outcome) => (
            <RevealInvocationCard
              key={outcome.id}
              outcome={outcome}
              onRevealSound={props.onRevealSound}
              activeMusic={activeMusicDrawId === outcome.id}
              autoplay={autoplayMusic}
              onListen={() => {
                setActiveMusicDrawId(outcome.id);
                setAutoplayMusic(true);
              }}
              onStopMusic={() => {
                setActiveMusicDrawId('');
                setAutoplayMusic(false);
              }}
            />
          ))}
        </div>
        {props.revealedCount < props.latest.draws.length && <p className="muted reveal-progress">Revelando {props.revealedCount} de {props.latest.draws.length}...</p>}
      </section>}
    </section>
  );
}

function RevealInvocationCard({
  outcome,
  onRevealSound,
  activeMusic,
  autoplay,
  onListen,
  onStopMusic
}: {
  outcome: DrawOutcome;
  onRevealSound: () => void;
  activeMusic: boolean;
  autoplay: boolean;
  onListen: () => void;
  onStopMusic: () => void;
}) {
  const rewards = [
    Number(outcome.duplicate_gold_amount ?? 0) > 0 ? `+${Number(outcome.duplicate_gold_amount).toLocaleString('pt-BR')} ${currencyLabel('gold', Number(outcome.duplicate_gold_amount))}` : '',
    Number(outcome.duplicate_gems_amount ?? 0) > 0 ? `+${Number(outcome.duplicate_gems_amount).toLocaleString('pt-BR')} ${currencyLabel('gems', Number(outcome.duplicate_gems_amount))}` : '',
    Number(outcome.duplicate_xp_amount ?? 0) > 0 ? `+${Number(outcome.duplicate_xp_amount).toLocaleString('pt-BR')} XP` : ''
  ].filter(Boolean);
  const odds = formatOdds(
    outcome.effective_card_numerator,
    outcome.effective_card_denominator,
    outcome.effective_card_chance
  );
  return <article
    className={`reveal-card level-${outcome.animation_level} effect-${outcome.visual_effect}`}
    style={{
      borderColor: `${outcome.rarity_color_primary}99`,
      boxShadow: effectShadow(outcome.visual_effect, outcome.rarity_color_primary)
    }}
    onAnimationEnd={onRevealSound}
  >
    <div className="card-art" style={{ backgroundColor: outcome.rarity_color_primary, borderBottom: `3px solid ${outcome.rarity_color_secondary}` }}>
      <CardArtwork imagePath={outcome.image_path} alt={`${outcome.card_name} — ${outcome.rarity_name}`} />
    </div>
    <span className="rarity-name" style={{ color: outcome.rarity_color_primary }}>{outcome.rarity_name}</span>
    <strong>{outcome.card_name}</strong>
    <small>Chance efetiva: {odds.fraction} · {odds.percent}</small>
    {outcome.collection_quantity !== null && outcome.collection_quantity !== undefined
      && <small>{outcome.collection_quantity} {outcome.collection_quantity === 1 ? 'cópia' : 'cópias'} na coleção</small>}
    {outcome.is_duplicate
      ? <div className="duplicate-reward" role="status">
        <strong>Duplicata convertida</strong>
        <span>{rewards.length ? rewards.join(' · ') : 'Conversão registrada'}</span>
      </div>
      : <small className="new-card-label">Nova carta adicionada à coleção</small>}
    {outcome.youtube_video_id && (activeMusic
      ? <div className="youtube-player">
        <iframe
          title={`Player oficial do YouTube para ${outcome.card_name}`}
          src={`https://www.youtube-nocookie.com/embed/${outcome.youtube_video_id}?autoplay=${autoplay ? '1' : '0'}&controls=1`}
          allow="autoplay; encrypted-media; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
        <span>Player oficial do YouTube</span>
        <button type="button" className="quiet-button" onClick={onStopMusic}>Desligar música</button>
      </div>
      : <button type="button" className="quiet-button" onClick={onListen}>OUVIR no YouTube</button>)}
  </article>;
}

function effectShadow(effect: DrawOutcome['visual_effect'], color: string): string {
  const shadows: Record<DrawOutcome['visual_effect'], string> = {
    glow: `0 0 18px ${color}55`,
    particles: `0 0 0 2px ${color}33, 0 0 24px ${color}44`,
    reveal: `0 8px 26px ${color}44`,
    aura: `0 0 30px ${color}66`
  };
  return shadows[effect];
}

function readPendingBannerId(): string | null {
  const saved = localStorage.getItem('rng.pendingDraw');
  if (!saved) return null;
  try {
    const pending = JSON.parse(saved) as Partial<{ bannerId: string }>;
    return typeof pending.bannerId === 'string' ? pending.bannerId : null;
  } catch {
    return null;
  }
}

function availabilityLabel(status: InvocationBannerSummary['availability']['status']): string {
  const labels: Record<InvocationBannerSummary['availability']['status'], string> = {
    upcoming: 'em breve',
    ended: 'encerrado',
    empty_pool: 'sem cartas',
    pity_unavailable: 'garantia indisponível',
    available: 'disponível'
  };
  return labels[status];
}

