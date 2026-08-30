/* ============================================================
   cloud.js — ログイン（マジックリンク）と複数端末での閲覧（任意機能）
   ログインしなくてもアプリは今まで通りローカルだけで動く。
   ログインすると data/state.json / localStorage に加えて、Supabase上の
   自分専用の行（RLSで他人からは読めない）にも同期し、他端末から
   同じ内容を続けて見られるようになる。
   ============================================================ */
const Cloud = (() => {
  const SUPABASE_URL = 'https://zahhyzplkpqfkuylupkw.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_IxkboLrhZ_zV_9LAcxAGqg_HT47h-56';

  const client = (typeof window.supabase !== 'undefined')
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

  let session = null;
  const listeners = [];

  async function init() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    session = data.session;
    client.auth.onAuthStateChange((_event, s) => {
      session = s;
      listeners.forEach((fn) => fn(session));
    });
    return session;
  }

  async function sendMagicLink(email) {
    if (!client) return 'クラウド機能が読み込まれていません';
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname }
    });
    return error ? error.message : null;
  }

  async function verifyCode(email, code) {
    if (!client) return 'クラウド機能が読み込まれていません';
    const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
    return error ? error.message : null;
  }

  async function signOut() {
    if (client) await client.auth.signOut();
    session = null;
  }

  async function pull() {
    if (!client || !session) return null;
    const { data, error } = await client
      .from('app_state')
      .select('data')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error) { console.warn('[cloud] pull failed', error); return null; }
    return data ? data.data : null;
  }

  async function push(state) {
    if (!client || !session) return false;
    const { error } = await client
      .from('app_state')
      .upsert({ user_id: session.user.id, data: state, updated_at: new Date().toISOString() });
    if (error) { console.warn('[cloud] push failed', error); return false; }
    return true;
  }

  return {
    init, sendMagicLink, verifyCode, signOut, pull, push,
    isLoggedIn: () => !!session,
    userEmail: () => (session ? session.user.email : null),
    onAuth: (fn) => listeners.push(fn)
  };
})();
