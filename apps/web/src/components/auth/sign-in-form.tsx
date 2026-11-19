import { authErrorMessage } from "@/lib/error-message";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { t, useT } from "@/i18n";
import { isServerUnreachable } from "@/lib/server-status";

interface SignInValues {
  email: string;
  password: string;
}

export function SignInForm() {
  const t = useT();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>();

  async function onSubmit(values: SignInValues) {
    setServerError(null);
    try {
      const { error } = await authClient.signIn.email(values);
      if (error) {
        setServerError(authErrorMessage(error, t("auth.signIn.failed")));
      }
    } catch (err) {
      // The client throws when no answer comes back at all.
      setServerError(isServerUnreachable(err) ? t("errors.serverUnreachable") : t("auth.signIn.failed"));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
      <div className="space-y-2">
        <Label htmlFor="signin-email">{t("auth.field.email")}</Label>
        <Input
          id="signin-email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com" // i18n-ok
          {...register("email", { required: t("auth.error.emailRequired") })}
        />
        {errors.email && (
          <p className="text-sm text-destructive">{errors.email.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="signin-password">{t("auth.field.password")}</Label>
        <Input
          id="signin-password"
          type="password"
          autoComplete="current-password"
          {...register("password", { required: t("auth.error.passwordRequired") })}
        />
        {errors.password && (
          <p className="text-sm text-destructive">{errors.password.message}</p>
        )}
      </div>

      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? t("auth.signIn.submitting") : t("auth.signIn.submit")}
      </Button>
    </form>
  );
}
