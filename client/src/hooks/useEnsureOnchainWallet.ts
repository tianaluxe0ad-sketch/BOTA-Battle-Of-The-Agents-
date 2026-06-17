import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";

type WalletLike = {
  address?: string | null;
};

import { isEVMAddress, isSolanaAddress } from "@/lib/utils";

function normalizeWalletAddress(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (isEVMAddress(value)) return value;
  if (isSolanaAddress(value)) return value;
  return null;
}

export function getPreferredOnchainWalletAddress(
  user: any,
  wallets: WalletLike[],
): string | null {
  const connectedWallets = Array.isArray(wallets)
    ? wallets
        .map((wallet) => normalizeWalletAddress(wallet?.address))
        .filter((value): value is string => Boolean(value))
    : [];

  if (connectedWallets.length === 0) {
    return null;
  }

  const userCandidates = [
    user?.walletAddress,
    user?.primaryWalletAddress,
    user?.wallet?.address,
    ...(Array.isArray(user?.walletAddresses) ? user.walletAddresses : []),
  ]
    .map((candidate) => normalizeWalletAddress(candidate))
    .filter((value): value is string => Boolean(value));

  for (const candidate of userCandidates) {
    const matched = connectedWallets.find(
      (walletAddress) => walletAddress.toLowerCase() === candidate.toLowerCase(),
    );
    if (matched) {
      return matched;
    }
  }

  return connectedWallets[0] || null;
}

export function useEnsureOnchainWallet() {
  const { isAuthenticated, login, user } = useAuth();
  const { wallets, ready: walletsReady } = useWallets();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { connectOrCreateWallet } = usePrivy();

  const ensureOnchainWallet = async (intentLabel = "continue") => {
    if (!isAuthenticated) {
      login();
      throw new Error(`Sign in to ${intentLabel}.`);
    }

    if (!walletsReady) {
      throw new Error("Wallets are still loading. Please wait a moment and try again.");
    }

    const walletAddress = getPreferredOnchainWalletAddress(user, wallets as WalletLike[]);
    if (!walletAddress) {
      connectOrCreateWallet();
      throw new Error(`Finish the Privy wallet setup to ${intentLabel}, then retry.`);
    }

    try {
      await apiRequest("PUT", "/api/users/me/wallet", { walletAddress });
    } catch (error) {
      console.warn("Failed to sync connected wallet to user profile:", error);
    }

    return {
      walletAddress,
      wallets,
    };
  };

  return {
    ensureOnchainWallet,
    wallets,
    solanaWallets,
    walletsReady,
  };
}
