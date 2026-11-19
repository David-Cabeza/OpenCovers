import { useState } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LanguageSelect } from "@/components/layout/language-select";
import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";

const COPY = {
  "sign-in": { title: "Welcome back", description: "Sign in to manage your venue's reservations." },
  "sign-up": { title: "Create your account", description: "Set up OpenCovers for your restaurant." },
} as const;

export function AuthScreen() {
  const [tab, setTab] = useState<keyof typeof COPY>("sign-in");
  return (
    <main className="relative flex min-h-dvh items-center justify-center p-6">
      <div className="absolute right-4 top-4">
        <LanguageSelect />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-14 text-primary" />
          <div>
            <h1 className="font-display text-3xl">OpenCovers</h1>
            <p className="text-sm text-muted-foreground">
              Reservations for restaurants
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{COPY[tab].title}</CardTitle>
            <CardDescription>{COPY[tab].description}</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={(v) => setTab(v as keyof typeof COPY)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="sign-in">Sign in</TabsTrigger>
                <TabsTrigger value="sign-up">Sign up</TabsTrigger>
              </TabsList>
              <TabsContent value="sign-in">
                <SignInForm />
              </TabsContent>
              <TabsContent value="sign-up">
                <SignUpForm />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
