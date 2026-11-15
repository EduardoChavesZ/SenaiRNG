import { useEffect, useState, type CSSProperties } from 'react';
import type { InvocationBannerSummary } from '../api';

type BannerMedia = Pick<
  InvocationBannerSummary,
  'name' | 'description' | 'imagePath' | 'imageMimeType' | 'fallbackImagePath' | 'imageFocalX' | 'imageFocalY'
>;

export function BannerArtwork({
  banner,
  reducedMotion,
  eager = false,
  className = ''
}: {
  banner: BannerMedia;
  reducedMotion: boolean;
  eager?: boolean;
  className?: string;
}) {
  const [paused, setPaused] = useState(reducedMotion);
  const [failed, setFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const animated = banner.imageMimeType === 'image/gif';
  const useFallback = Boolean(
    banner.fallbackImagePath
    && (failed || (animated && (paused || reducedMotion)))
  );
  const source = useFallback ? banner.fallbackImagePath : banner.imagePath;

  useEffect(() => {
    setPaused(reducedMotion);
    setFailed(false);
    setFallbackFailed(false);
  }, [banner.imagePath, banner.fallbackImagePath, banner.imageMimeType, reducedMotion]);

  return <div
    className={`banner-artwork ${className}`}
    style={{
      '--banner-focal-x': `${banner.imageFocalX}%`,
      '--banner-focal-y': `${banner.imageFocalY}%`
    } as CSSProperties}
  >
    {source && !fallbackFailed
      ? <img
        src={source}
        alt={banner.name}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : 'auto'}
        decoding="async"
        onError={() => {
          if (!useFallback && banner.fallbackImagePath) setFailed(true);
          else setFallbackFailed(true);
        }}
      />
      : <div className="banner-artwork-placeholder" role="img" aria-label={`${banner.name}: imagem indisponível`}>
        <span>{banner.imagePath ? 'Imagem indisponível' : 'Imagem do banner não cadastrada'}</span>
      </div>}
    <div className="banner-artwork-shade" aria-hidden="true" />
    <div className="banner-artwork-copy">
      <h3>{banner.name}</h3>
      {banner.description && <p>{banner.description}</p>}
    </div>
    {animated && banner.fallbackImagePath && <button
      type="button"
      className="banner-motion-control"
      aria-label={reducedMotion ? 'Animação pausada pela preferência de movimento reduzido' : paused ? 'Reproduzir animação do banner' : 'Pausar animação do banner'}
      aria-pressed={paused || reducedMotion}
      disabled={reducedMotion}
      onClick={() => setPaused(!paused)}
    >{reducedMotion ? 'Movimento reduzido' : paused ? 'Reproduzir animação' : 'Pausar animação'}</button>}
  </div>;
}
