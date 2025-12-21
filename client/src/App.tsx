import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { useSyncExternalStore, useCallback } from "react";
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
import GroupPreview from "@/pages/GroupPreview";
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

function SemiPublicRoute({ component: Component }: { component: () => JSX.Element }) {
  const { isLoading, needsKeychainRedirect } = useAuth();

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

  return <Component />;
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={() => <ProtectedRoute component={Messages} />} />
      <Route path="/login" component={() => <PublicRoute component={Login} />} />
      <Route path="/discover" component={() => <ProtectedRoute component={GroupDiscovery} />} />
      <Route path="/join/:groupId" component={() => <SemiPublicRoute component={GroupPreview} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

// Custom hash location hook for static hosting (GitHub Pages)
const hashSubscribe = (callback: () => void) => {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
};

const getHashLocation = () => {
  const hash = window.location.hash;
  return hash.replace(/^#/, "") || "/";
};

function useHashLocation(): [string, (to: string) => void] {
  const location = useSyncExternalStore(hashSubscribe, getHashLocation);
  const navigate = useCallback((to: string) => {
    window.location.hash = to;
  }, []);
  return [location, navigate];
}

function Router() {
  // Use hash-based routing for GitHub Pages and other static hosting
  // This makes URLs like /#/login instead of /login, which works without server configuration
  return (
    <WouterRouter hook={useHashLocation}>
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
