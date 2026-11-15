import { useEffect, useState } from 'react';

export function CardArtwork({
  imagePath,
  alt,
  className = '',
  loading = 'lazy'
}: {
  imagePath: string | null;
  alt: string;
  className?: string;
  loading?: 'eager' | 'lazy';
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [imagePath]);

  return imagePath && !failed
    ? <img
      className={className}
      src={imagePath}
      alt={alt}
      loading={loading}
      decoding="async"
      onError={() => setFailed(true)}
    />
    : <span className={`card-image-placeholder ${className}`} role="img" aria-label={`${alt}: imagem indisponível`}>
      <span>{imagePath ? 'Imagem indisponível' : 'Imagem pendente'}</span>
    </span>;
}
