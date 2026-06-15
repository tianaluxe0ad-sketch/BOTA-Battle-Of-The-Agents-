import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatAgentName(name?: string | null) {
  if (!name) return "Unknown Agent";
  
  let displayName = name;
  
  if (name.includes(":")) {
    const parts = name.split(":");
    displayName = parts[parts.length - 1];
  }
  
  if (displayName.length > 16 && (displayName.startsWith("0x") || /^[A-HJ-NP-Za-km-z1-9]{32,44}$/.test(displayName) || /^[a-zA-Z0-9]{30,}$/.test(displayName))) {
    return `${displayName.slice(0, 6)}...${displayName.slice(-4)}`;
  }
  
  return displayName;
}

export function isSolanaAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

export function isEVMAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function truncateWallet(address: string): string {
  if (!address) return '';
  if (isEVMAddress(address) || isSolanaAddress(address)) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
  return address;
}
