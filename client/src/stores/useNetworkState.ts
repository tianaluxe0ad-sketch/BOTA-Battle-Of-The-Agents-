import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SupportedNetwork = 'evm' | 'solana';

interface NetworkState {
  activeNetwork: SupportedNetwork;
  setNetwork: (network: SupportedNetwork) => void;
}

export const useNetworkState = create<NetworkState>()(
  persist(
    (set) => ({
      activeNetwork: 'evm', // Default to EVM
      setNetwork: (network) => set({ activeNetwork: network }),
    }),
    {
      name: 'bantah-network-storage',
    }
  )
);
