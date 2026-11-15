import { useEffect, useState, type FormEvent } from 'react';
import { api, type User } from '../api';

const petals = Array.from({ length: 22 }, (_, index) => ({
  left: `${(index * 37) % 100}%`,
  animationDelay: `${-((index * 1.7) % 14)}s`,
  animationDuration: `${11 + (index % 7) * 1.3}s`
}));

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [musicVideoId, setMusicVideoId] = useState<string | null>(null);
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [musicError, setMusicError] = useState('');

  useEffect(() => {
    let active = true;
    void api.loginConfig()
      .then(({ musicVideoId: configuredVideoId }) => {
        if (active) setMusicVideoId(configuredVideoId);
      })
      .catch(() => {
        if (active) setMusicError('A trilha sonora não pôde ser carregada.');
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = mode === 'login'
        ? await api.login(String(form.get('email')), String(form.get('password')))
        : await api.register(String(form.get('email')), String(form.get('password')));
      onAuthenticated(result.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível autenticar.');
    } finally {
      setBusy(false);
    }
  }

  function changeMode(nextMode: 'login' | 'register') {
    setMode(nextMode);
    setError('');
  }

  return (
    <main className="auth-page">
      <div className="auth-petals" aria-hidden="true">
        {petals.map((petal, index) => (
          <span className="auth-petal" key={index} style={petal} />
        ))}
      </div>

      <div className="auth-layout">
        <section className="auth-intro" aria-label="Sobre a SorteSenai">
          <a className="auth-brand" href="/" aria-label="SorteSenai, início">
            <span>SORTE</span>SENAI
          </a>
          <p className="auth-intro-kicker">COLEÇÃO · RECOMPENSAS · DESCOBERTAS</p>
          <h1>Uma nova carta.<br /><span>Uma nova história.</span></h1>
          <p className="auth-intro-copy">
            Entre no universo SorteSenai, acompanhe sua coleção e descubra o que cada invocação reserva.
          </p>
          <div className="auth-highlights">
            <div className="auth-highlight">
              <span aria-hidden="true">01</span>
              <div><strong>Construa sua coleção</strong><small>Reúna cartas e acompanhe seu progresso.</small></div>
            </div>
            <div className="auth-highlight">
              <span aria-hidden="true">02</span>
              <div><strong>Volte para novas descobertas</strong><small>Recompensas e banners em um só lugar.</small></div>
            </div>
          </div>
        </section>

        <section className="auth-card" aria-label={mode === 'login' ? 'Entrar na plataforma' : 'Criar uma conta'}>
          <div className="auth-card-heading">
            <p className="auth-card-kicker">ACESSO À PLATAFORMA</p>
            <h2>{mode === 'login' ? 'Boas-vindas de volta' : 'Crie sua conta'}</h2>
            <p>{mode === 'login' ? 'Entre para continuar sua jornada.' : 'Leva só um momento para começar.'}</p>
          </div>

          <div className="auth-tabs" role="group" aria-label="Tipo de acesso">
            <button type="button" aria-pressed={mode === 'login'} className={mode === 'login' ? 'selected' : ''} onClick={() => changeMode('login')}>Entrar</button>
            <button type="button" aria-pressed={mode === 'register'} className={mode === 'register' ? 'selected' : ''} onClick={() => changeMode('register')}>Criar conta</button>
          </div>

          <form className="auth-form" onSubmit={submit} aria-busy={busy}>
            <label htmlFor="email">E-mail</label>
            <input id="email" name="email" type="email" autoComplete="email" placeholder="voce@exemplo.com" required maxLength={254} />
            <label htmlFor="password">Senha</label>
            <div className="auth-password-field">
              <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Digite sua senha" minLength={10} maxLength={128} required />
              <button type="button" className="auth-password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                {showPassword ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
            {mode === 'register' && <p className="auth-field-note">Use uma senha com pelo menos 10 caracteres.</p>}
            {error && <p className="message error" role="alert">{error}</p>}
            <button className="primary-button full-width auth-submit" type="submit" disabled={busy}>
              {busy ? 'Aguarde...' : mode === 'login' ? 'Entrar na plataforma' : 'Criar conta'}
            </button>
          </form>

          {musicVideoId && (
            <div className="auth-music">
              <button className="auth-music-toggle" type="button" aria-expanded={musicEnabled} aria-controls={musicEnabled ? 'auth-music-player' : undefined} onClick={() => setMusicEnabled(!musicEnabled)}>
                <span aria-hidden="true">♫</span>
                {musicEnabled ? 'Fechar player' : 'Ouvir música da página'}
              </button>
              {musicEnabled && (
                <iframe
                  id="auth-music-player"
                  className="auth-music-player"
                  src={`https://www.youtube-nocookie.com/embed/${musicVideoId}?autoplay=1&controls=1&rel=0`}
                  title="Música da página de acesso"
                  allow="autoplay; encrypted-media; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  loading="lazy"
                />
              )}
            </div>
          )}
          {musicError && <p className="auth-music-error" role="status">{musicError}</p>}
          <p className="auth-disclaimer">Entretenimento com moedas virtuais. Sem compras ou pagamentos.</p>
        </section>
      </div>

      <footer className="auth-artwork-slot" data-artwork-slot="login-footer" aria-label="Espaço reservado para futuras imagens animadas" />
    </main>
  );
}
