import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const nav = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try { await login(email, password); nav('/orgs'); }
    catch (err: any) { setError(err?.message || 'Login failed'); }
  };

  return <div className="center"><form className="card" onSubmit={submit}><h2>Login</h2>
    <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
    <input value={password} type="password" onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
    {error ? <div className="error-banner">{error}</div> : null}
    <button type="submit">Sign in</button>
  </form></div>;
}
