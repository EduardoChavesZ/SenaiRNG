import { useEffect, useState } from 'react';
import { api, type User } from '../api';
import { AuthScreen } from './AuthScreen';
import { GameDashboard } from './GameDashboard';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState('');

  useEffect(() => {
    void api.me()
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Não foi possível conectar ao servidor.'))
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    if (logoutBusy) return;
    setLogoutError('');
    setLogoutBusy(true);
    try {
      await api.logout();
      setUser(null);
    } catch (cause) {
      setLogoutError(cause instanceof Error ? cause.message : 'Não foi possível encerrar a sessão.');
    } finally {
      setLogoutBusy(false);
    }
  }

  if (loading) return <main className="loading">Carregando...</main>;
  if (!user && error) return <main className="loading"><div><p role="alert">{error}</p><button className="secondary-button" type="button" onClick={() => window.location.reload()}>Tentar novamente</button></div></main>;
  if (!user) return <AuthScreen onAuthenticated={setUser} />;
  return <GameDashboard
    user={user}
    onLogout={() => void logout()}
    logoutBusy={logoutBusy}
    logoutError={logoutError}
  />;
}
