import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ExceptionsProvider } from "@/contexts/ExceptionsContext";
import { HiddenConversationsProvider } from "@/contexts/HiddenConversationsContext";
import { KeychainRedirect } from "@/components/KeychainRedirect";
import Login from "@/pages/Login";
import Messages from "@/pages/Messages";
import GroupDiscovery from "@/pages/GroupDiscovery";
import NotFound from "@/pages/not-found";

function ProtectedRoute({ component: Component }: { component: () => JSX.Element }) {
  const { user, isLoading, needsKeychainRedirect } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (needsKeychainRedirect) {
    return <KeychainRedirect />;
  }

  if (!user?.isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <Component />;
}

function PublicRoute({ component: Component }: { component: () => JSX.Element }) {
  const { user, isLoading, needsKeychainRedirect } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (needsKeychainRedirect) {
    return <KeychainRedirect />;
  }

  if (user?.isAuthenticated) {
    return <Redirect to="/" />;
  }

  return <Component />;
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={() => <ProtectedRoute component={Messages} />} />
      <Route path="/login" component={() => <PublicRoute component={Login} />} />
      <Route path="/discover" component={() => <ProtectedRoute component={GroupDiscovery} />} />
      <Route path="/join/:groupId" component={() => <ProtectedRoute component={Messages} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function Router() {
  // Get base path from Vite - will be "/" in dev or "/hiveencrypt/" on GitHub Pages
  const base = import.meta.env.BASE_URL || "/";
  // Remove trailing slash for wouter (it expects "/hiveencrypt" not "/hiveencrypt/")
  const basePath = base.endsWith("/") && base.length > 1 ? base.slice(0, -1) : base === "/" ? "" : base;
  
  return (
    <WouterRouter base={basePath}>
      <AppRoutes />
    </WouterRouter>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ExceptionsProvider>
            <HiddenConversationsProvider>
              <TooltipProvider>
                <Toaster />
                <Router />
              </TooltipProvider>
            </HiddenConversationsProvider>
          </ExceptionsProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
