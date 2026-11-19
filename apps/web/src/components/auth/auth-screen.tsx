import { BrandMark } from "@/components/brand/brand-mark";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useDemoStatus } from "@/lib/demo";
import { DemoSignIn } from "./demo-sign-in";
import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";

export function AuthScreen() {
  const demo = useDemoStatus();
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
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

        {demo === null ? (
          <Skeleton className="h-72 w-full" />
        ) : demo.enabled ? (
          <Card>
            <CardHeader>
              <CardTitle>Try the demo</CardTitle>
              <CardDescription>
                Sign in to get your own sandbox restaurant, ready to use. No password: we email you a link.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DemoSignIn googleEnabled={demo.googleEnabled} />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Welcome back</CardTitle>
              <CardDescription>
                Sign in to manage your venue's reservations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="sign-in">
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
        )}
      </div>
    </main>
  );
}
