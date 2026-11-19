import { authErrorMessage } from "@/lib/error-message";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { t, useT } from "@/i18n";
import { isServerUnreachable } from "@/lib/server-status";

interface SignUpValues {
  name: string;
  email: string;
  password: string;
}

export function SignUpForm({
  invitationToken,
  onSuccess,
}: {
  invitationToken?: string;
  onSuccess?: () => void;
}) {
  const t = useT();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>();

  async function onSubmit(values: SignUpValues) {
    setServerError(null);
    let error: Awaited<ReturnType<typeof authClient.signUp.email>>["error"];
    try {
      ({ error } = await authClient.signUp.email({
        ...values,
        ...(invitationToken
          ? { fetchOptions: { headers: { "X-Invitation-Token": invitationToken } } }
          : {}),
      }));
    } catch (err) {
      // The client throws when no answer comes back at all.
      const message = isServerUnreachable(err) ? t("errors.serverUnreachable") : t("auth.signUp.failed");
      setServerError(message);
      return;
    }
    if (error) {
      setServerError(authErrorMessage(error, t("auth.signUp.failed")));
      return;
    }
    onSuccess?.();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
      <div className="space-y-2">
        <Label htmlFor="signup-name">{t("auth.field.name")}</Label>
        <Input
          id="signup-name"
          autoComplete="name"
          placeholder={t("auth.signUp.namePlaceholder")}
          {...register("name", { required: t("auth.error.nameRequired") })}
        />
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-email">{t("auth.field.email")}</Label>
        <Input
          id="signup-email"
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
        <Label htmlFor="signup-password">{t("auth.field.password")}</Label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          placeholder={t("auth.signUp.passwordPlaceholder")}
          {...register("password", {
            required: t("auth.error.passwordRequired"),
            minLength: {
              value: 8,
              message: t("auth.error.passwordMin"),
            },
          })}
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
        {isSubmitting ? t("auth.signUp.submitting") : t("auth.signUp.submit")}
      </Button>
    </form>
  );
}
