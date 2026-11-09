import { authClient } from "./lib/auth-client";

export default function App() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <p>Loading...</p>;
  }

  if (!session) {
    return <AuthForms />;
  }

  return (
    <main>
      <h1>OpenCovers</h1>
      <p>Signed in as {session.user.email}.</p>
      <button type="button" onClick={() => authClient.signOut()}>
        Sign out
      </button>
    </main>
  );
}

function AuthForms() {
  return (
    <main>
      <h1>OpenCovers</h1>
      <h2>Sign up</h2>
      <UserForm action="signUp" />
      <h2>Sign in</h2>
      <UserForm action="signIn" />
    </main>
  );
}

function UserForm({ action }: { action: "signUp" | "signIn" }) {
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email"));
    const password = String(data.get("password"));
    const result =
      action === "signUp"
        ? await authClient.signUp.email({
            email,
            password,
            name: String(data.get("name")),
          })
        : await authClient.signIn.email({ email, password });
    if (result.error) {
      alert(result.error.message);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {action === "signUp" && <input name="name" placeholder="Name" />}
      <input name="email" placeholder="Email" type="email" required />
      <input name="password" placeholder="Password" type="password" required />
      <button type="submit">{action === "signUp" ? "Sign up" : "Sign in"}</button>
    </form>
  );
}
