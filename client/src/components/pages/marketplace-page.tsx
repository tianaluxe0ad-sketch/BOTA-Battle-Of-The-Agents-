'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BadgeDollarSign,
  Crown,
  Filter,
  Heart,
  Search,
  Shield,
  Star,
  Store,
  Swords,
  Trophy,
  Users,
  X,
  Gem,
  Battery,
  Rocket,
  Wrench,
  Crosshair,
  PlusSquare,
  Satellite,
  Bot,
  Loader2,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Gen1InventoryRow,
  Gen1Listing,
  Gen1Tool,
  useCancelGen1Listing,
  useCreateGen1Listing,
  useGen1Inventory,
  useGen1Listings,
  useBuyGen1Listing,
  useBuyGen1Tool,
  useGen1Tools,
} from '@/hooks/useGen1Economy'
import { useGen1Packs, useBuyGen1Pack, useOpenGen1Pack } from '@/hooks/useGen1Packs'
import { botaCharacterAlt, botaFighterProfileArt } from '@/lib/botaCharacterLayer'
import { getFighterSourceMeta } from '@/lib/bantahbro/fighterIdentity'
import { useAuth } from '@/hooks/useAuth'
import { useEnsureOnchainWallet } from '@/hooks/useEnsureOnchainWallet'
import { apiRequest } from '@/lib/queryClient'
import { executeBantahBroPreparedWalletAction } from '@/lib/walletActions'
import { purchaseBcWithWallet } from '@/lib/bcPurchase'

import type { AppSection } from '@/app/page'
import type { BotaFighterProfile } from '@shared/botaFighterProfile'
import type { OnchainPublicConfig } from '@shared/onchainConfig'
import type { BantahBroPreparedWalletAction, BantahBroWalletAction } from '@shared/bantahBroWallet'
import { BotaMarketplace } from '@/components/BotaMarketplace'
import { BotaPackOpener } from '@/components/BotaPackOpener'

type FighterProfilesFeed = {
  profiles: BotaFighterProfile[]
  updatedAt: string
}

type MarketFilter = 'all' | 'tradable' | 'ens' | 'virtuals' | 'eliza' | 'nft'

type SaleEvent = {
  id: string
  fighterName: string
  price: number
  currency: string
  when: string | null
}

type MarketplaceAgent = {
  id: string
  name: string
  source: string
  sourceKey: MarketFilter | 'bankr' | 'agentkit' | 'game-sdk' | 'bota' | 'meme'
  sourceIconUrl: string | null
  avatarUrl: string
  rank: number | null
  wins: number
  losses: number
  battles: number
  winRate: number
  predictionAccuracy: number | null
  bantCredits: number
  score: number
  streak: number
  ownerAddress: string | null
  isExternalApiAgent: boolean
  isUserOwned: boolean
  canList: boolean
  canTrade: boolean
  valueScore: number
  valueTier: string
  listing: {
    active: boolean
    status: string
    price: number | null
    currency: string
    priceLabel: string | null
    seller: string | null
    checkoutUrl: string | null
  }
  sales: SaleEvent[]
}

const FILTERS: Array<{ value: MarketFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'tradable', label: 'Tradable' },
  { value: 'ens', label: 'ENS' },
  { value: 'virtuals', label: 'Virtuals' },
  { value: 'eliza', label: 'Eliza' },
  { value: 'nft', label: 'NFT Fighters' },
]

const TOOL_SORT_OPTIONS = [
  { value: 'usage', label: 'Most Used' },
  { value: 'price-low', label: 'Low to High' },
  { value: 'price-high', label: 'High to Low' },
]

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeAddress(value?: string | null) {
  const trimmed = String(value || '').trim()
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed.toLowerCase() : ''
}

function viewerWallets(user: unknown) {
  const candidate = user as any
  const wallets = [
    candidate?.wallet?.address,
    candidate?.walletAddress,
    candidate?.primaryWalletAddress,
    ...(Array.isArray(candidate?.walletAddresses) ? candidate.walletAddresses : []),
    ...(Array.isArray(candidate?.linkedAccounts)
      ? candidate.linkedAccounts.map((account: any) => account?.address)
      : []),
  ]
    .map((wallet) => normalizeAddress(wallet))
    .filter(Boolean)

  return Array.from(new Set(wallets))
}

function formatCompact(value: number) {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0)
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(1)}M`
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(1)}K`
  return Math.round(safe).toLocaleString()
}

function formatMoney(value: number, currency = 'USDC') {
  const amount = formatCompact(value)
  const normalizedCurrency = String(currency || '').trim().toUpperCase()
  if (normalizedCurrency === 'USDC' || normalizedCurrency === 'USD') {
    return `$${amount}`
  }
  return `${amount} ${normalizedCurrency}`
}

function shortAddress(value?: string | null) {
  const normalized = normalizeAddress(value)
  if (!normalized) return 'Wallet owner'
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`
}

function getToolRarity(tool: Gen1Tool): 'common' | 'rare' | 'epic' {
  const rarity = String(tool.rarity || '').toLowerCase()
  if (rarity === 'epic') return 'epic'
  if (rarity === 'rare') return 'rare'
  if (rarity === 'common') return 'common'

  const name = tool.name?.toLowerCase() || ''
  if (name.includes('epic') || name.includes('soul') || name.includes('dominion') || name.includes('harvester')) return 'epic'
  if (name.includes('rare') || name.includes('adaptive') || name.includes('double') || name.includes('counter')) return 'rare'
  return 'common'
}

function getToolIcon(tool: Gen1Tool) {
  const name = tool.name?.toLowerCase() || ''
  if (name.includes('shield') || name.includes('tactical')) {
    return <Shield className="h-4 w-4" />
  }
  if (name.includes('dominion') || name.includes('core') || name.includes('harvester') || name.includes('soul')) {
    return <Crown className="h-4 w-4" />
  }
  if (name.includes('strike') || name.includes('counter') || name.includes('double')) {
    return <Swords className="h-4 w-4" />
  }
  if (name.includes('precision') || name.includes('adaptive') || name.includes('gear') || name.includes('module') || name.includes('dodge')) {
    return <Star className="h-4 w-4" />
  }
  return <Shield className="h-4 w-4" />
}

const TOOL_CATALOG_PLACEHOLDERS: Array<Pick<Gen1Tool, 'tool_id' | 'name' | 'rarity' | 'description' | 'supply_total'>> = [
  { tool_id: 'sample-common', name: 'Arena Booster', rarity: 'common', description: 'Basic utility module for new fighters.', supply_total: 820 },
  { tool_id: 'sample-rare', name: 'Tactical Shield', rarity: 'rare', description: 'Increases durability under pressure.', supply_total: 170 },
  { tool_id: 'sample-epic', name: 'Dominion Core', rarity: 'epic', description: 'Elite module for advanced arena tactics.', supply_total: 32 },
  { tool_id: 'sample-common-2', name: 'Adaptive Gear', rarity: 'common', description: 'Adjusts to opponent tactics in real-time.', supply_total: 950 },
  { tool_id: 'sample-rare-2', name: 'Double Strike', rarity: 'rare', description: 'Enables consecutive attacks with precision.', supply_total: 245 },
  { tool_id: 'sample-epic-2', name: 'Soul Harvester', rarity: 'epic', description: 'Drains opponent energy for tactical advantage.', supply_total: 18 },
  { tool_id: 'sample-common-3', name: 'Reflexive Dodge', rarity: 'common', description: 'Automatically evades basic attacks.', supply_total: 1200 },
  { tool_id: 'sample-rare-3', name: 'Counter Attack', rarity: 'rare', description: 'Reflects damage back to attackers.', supply_total: 310 },
  { tool_id: 'sample-epic-3', name: 'Harvester Protocol', rarity: 'epic', description: 'Maximum control with elite arena dominance.', supply_total: 42 },
  { tool_id: 'sample-common-4', name: 'Precision Module', rarity: 'common', description: 'Improves accuracy and targeting systems.', supply_total: 680 },
  { tool_id: 'sample-rare-4', name: 'Adaptive Armor', rarity: 'rare', description: 'Hardens against repeated attack patterns.', supply_total: 155 },
  { tool_id: 'sample-epic-4', name: 'Quantum Shift', rarity: 'epic', description: 'Transcends normal arena physics and rules.', supply_total: 11 },
]
 

function valueScoreFor(profile: any, winRate: number, listingActive: boolean) {
  const fame = Number(profile.fameScore || 0)
  const bant = Math.max(0, Math.round(Number(profile.bantCreditsEarned || profile.metadata?.bantCreditsEarned || 0)))
  const base = fame + bant / 1000
  return Math.round(base + (winRate || 0) / 2 + (listingActive ? 10 : 0))
}

function valueTier(score: number) {
  if (score >= 250) return 'Legend'
  if (score >= 150) return 'Elite'
  if (score >= 80) return 'Pro'
  return 'Novice'
}

function profileName(profile: any) {
  return String(profile.displayName || profile.name || profile.agentId || 'Unknown')
}

function sourceKeyForProfile(_: any): 'bota' {
  return 'bota'
}

function isExternalApiProfile(_: any) {
  return false
}

function isBantahMarketAsset(_: any, __: boolean) {
  return true
}

function saleEventsForProfile(_: any, __: any) {
  return []
}

function profileToMarketplaceAgent(profile: BotaFighterProfile, walletSet: Set<string>, viewerId?: string): MarketplaceAgent {
  const wins = Number(profile.wins || 0)
  const losses = Number(profile.losses || 0)
  const battles = Math.max(0, wins + losses)
  const winRate = battles > 0 ? Math.round((wins / battles) * 100) : 0
  const predictionAccuracy =
    numberValue((profile as any).metadata?.predictionAccuracy) ??
    numberValue((profile as any).metadata?.accuracy) ??
    numberValue((profile as any).metadata?.predictionWinRate)

  const marketplaceListing = (profile as any).metadata?.marketplaceListing;
  const isListed = !!marketplaceListing;

  const listing = {
    active: isListed,
    status: isListed ? 'Listed' : '',
    price: isListed ? Number(marketplaceListing.priceUsdt) : null,
    currency: 'USDT',
    priceLabel: isListed ? `$${marketplaceListing.priceUsdt} USDT` : null,
    seller: isListed ? marketplaceListing.sellerWallet : null,
    checkoutUrl: null,
  }

  const ownerAddress = normalizeAddress((profile as any).ownerAddress || (profile as any).owner || null)
  const isUserOwned = ownerAddress ? walletSet.has(ownerAddress) : false
  const valueScore = valueScoreFor(profile, winRate, listing.active)

  return {
    id: profile.agentId,
    name: profileName(profile),
    source: 'BOTA',
    sourceKey: sourceKeyForProfile(profile),
    sourceIconUrl: null,
    avatarUrl: botaFighterProfileArt({ avatarUrl: profile.avatarUrl, seed: profile.agentId, source: 'bota' }),
    rank: (profile as any).rank ?? null,
    wins,
    losses,
    battles,
    winRate,
    predictionAccuracy: predictionAccuracy ?? null,
    bantCredits: Math.max(0, Math.round(Number((profile as any).bantCreditsEarned || (profile as any).metadata?.bantCreditsEarned || 0))),
    score: Math.max(0, Math.round(Number((profile as any).fameScore || 0))),
    streak: Math.max(0, Math.round(Number((profile as any).currentStreak || 0))),
    ownerAddress,
    isExternalApiAgent: isExternalApiProfile(profile),
    isUserOwned,
    canList: isUserOwned,
    canTrade: isBantahMarketAsset(profile, listing.active),
    valueScore,
    valueTier: valueTier(valueScore),
    listing,
    sales: saleEventsForProfile(profile, listing),
  }
}


function ActionButtons({ agent, onNavigate }: { agent: MarketplaceAgent; onNavigate?: (section: AppSection) => void }) {
  if (agent.isExternalApiAgent) {
    return (
      <button
        type="button"
        onClick={() => onNavigate?.('battles')}
        className="h-9 rounded bg-primary px-3 text-xs font-black text-primary-foreground"
      >
        Challenge
      </button>
    )
  }

  if (agent.listing.active && !agent.isUserOwned) {
    if (agent.listing.checkoutUrl) {
      return (
        <a
          href={agent.listing.checkoutUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center rounded bg-primary px-3 text-xs font-black text-primary-foreground"
        >
          Buy Fighter
        </a>
      )
    }
    return (
      <button
        type="button"
        onClick={() => alert("Purchasing fighters is coming soon. For now, agents are displayed on the marketplace.")}
        className="inline-flex h-9 items-center rounded bg-primary px-3 text-xs font-black text-primary-foreground hover:bg-primary/90 transition"
      >
        Buy Fighter
      </button>
    )
  }

  if (agent.canList) {
    return (
      <button
        type="button"
        onClick={() => onNavigate?.('profile')}
        className="h-9 rounded bg-primary px-3 text-xs font-black text-primary-foreground"
      >
        {agent.listing.active ? 'Manage' : 'List Fighter'}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onNavigate?.('battles')}
      className="h-9 rounded bg-primary/12 px-3 text-xs font-black text-primary"
    >
      Challenge
    </button>
  )
}

function FighterCard({
  agent,
  onNavigate,
  onSelect,
}: {
  agent: MarketplaceAgent
  onNavigate?: (section: AppSection) => void
  onSelect: (agent: MarketplaceAgent) => void
}) {
  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-card shadow-sm\">
      <div className="relative h-32 overflow-hidden bg-background">
        <img
          src={agent.avatarUrl}
          alt={botaCharacterAlt(agent.name)}
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
        <div className="absolute left-3 top-3 rounded-xl bg-black/60 px-3 py-1.5 text-[11px] font-black uppercase text-white">
          {agent.valueTier}
        </div>
        {agent.sourceIconUrl ? (
          <span className="absolute bottom-3 right-3 grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-background shadow-lg">
            <img src={agent.sourceIconUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          </span>
        ) : null}
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-black">{agent.name}</h2>
            <p className="truncate text-[10px] font-bold text-muted-foreground">
              {agent.source} {agent.rank ? `#${agent.rank}` : ''}
            </p>
          </div>
          <div className="rounded-xl bg-primary/12 px-2 py-1 text-[10px] font-black text-primary">
            {agent.valueScore}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-xl bg-background/70 px-2 py-2">
            <div className="text-sm font-black">{agent.wins}W</div>
            <div className="text-[10px] font-bold uppercase text-muted-foreground">{agent.losses}L</div>
          </div>
          <div className="rounded-xl bg-background/70 px-2 py-2">
            <div className="text-sm font-black">{agent.winRate}%</div>
            <div className="text-[10px] font-bold uppercase text-muted-foreground">Win rate</div>
          </div>
          <div className="rounded-xl bg-background/70 px-2 py-2">
            <div className="text-sm font-black">{formatCompact(agent.bantCredits)}</div>
            <div className="text-[10px] font-bold uppercase text-muted-foreground">BC</div>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <div className="min-w-0">
            <div className="text-[9px] font-black uppercase text-muted-foreground">
              {agent.isExternalApiAgent ? 'Arena opponent' : agent.listing.status}
            </div>
            <div className="truncate text-sm font-black">
              {agent.listing.priceLabel || (agent.canTrade ? 'Not listed' : 'Challenge only')}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSelect(agent)}
              className="h-9 rounded-2xl bg-background px-3 text-xs font-black text-foreground hover:bg-background/80 transition"
            >
              Details
            </button>
            <ActionButtons agent={agent} onNavigate={onNavigate} />
          </div>
        </div>
      </div>
    </article>
  )
}

function FighterDetailOverlay({
  agent,
  onClose,
  onNavigate,
}: {
  agent: MarketplaceAgent
  onClose: () => void
  onNavigate?: (section: AppSection) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/68 p-2 backdrop-blur-sm md:items-center md:justify-center">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-card shadow-2xl">
        <div className="grid max-h-[92vh] overflow-y-auto md:grid-cols-[1fr_1fr]">
          <div className="relative min-h-[320px] overflow-hidden bg-background">
            <img
              src={agent.avatarUrl}
              alt={botaCharacterAlt(agent.name)}
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/86 via-black/18 to-transparent" />
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white"
              aria-label="Close fighter details"
            >
              <X size={17} />
            </button>
            <div className="absolute inset-x-0 bottom-0 p-4 text-white">
              <div className="inline-flex rounded bg-yellow-400 px-2 py-1 text-[10px] font-black uppercase text-black">
                {agent.valueTier}
              </div>
              <h2 className="mt-2 truncate text-3xl font-black uppercase leading-none">{agent.name}</h2>
              <p className="mt-1 text-sm font-bold text-white/72">{agent.source}</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 p-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded bg-background/70 p-3">
                <div className="text-[10px] font-black uppercase text-muted-foreground">Current Owner</div>
                <div className="mt-1 truncate text-sm font-black">{shortAddress(agent.ownerAddress)}</div>
              </div>
              <div className="rounded bg-background/70 p-3">
                <div className="text-[10px] font-black uppercase text-muted-foreground">Community</div>
                <div className="mt-1 truncate text-sm font-black">{agent.source}</div>
              </div>
            </div>

            <div className="rounded-lg bg-background/70 p-3">
              <div className="mb-2 text-[10px] font-black uppercase text-muted-foreground">Career</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-black">{agent.wins}</div>
                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Wins</div>
                </div>
                <div>
                  <div className="text-lg font-black">{agent.losses}</div>
                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Losses</div>
                </div>
                <div>
                  <div className="text-lg font-black">{agent.predictionAccuracy === null ? 'N/A' : `${Math.round(agent.predictionAccuracy)}%`}</div>
                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Accuracy</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-primary/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-black uppercase text-primary">Fighter Value Score</div>
                  <div className="mt-1 text-xl font-black">{agent.valueTier}</div>
                </div>
                <div className="text-4xl font-black text-primary">{agent.valueScore}</div>
              </div>
            </div>

            <div className="rounded-lg bg-background/70 p-3">
              <div className="mb-2 text-[10px] font-black uppercase text-muted-foreground">Price History</div>
              <div className="flex flex-col gap-2">
                {agent.sales.slice(0, 4).map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between rounded bg-card px-2 py-1.5 text-xs font-bold">
                    <span>{sale.when ? 'Sold' : 'Recorded sale'}</span>
                    <span className="font-black">{formatMoney(sale.price, sale.currency)}</span>
                  </div>
                ))}
                {agent.listing.active ? (
                  <div className="flex items-center justify-between rounded bg-card px-2 py-1.5 text-xs font-bold">
                    <span>Listed</span>
                    <span className="font-black">{agent.listing.priceLabel || 'No price'}</span>
                  </div>
                ) : null}
                {!agent.sales.length && !agent.listing.active ? (
                  <div className="rounded bg-card p-2 text-xs font-bold text-muted-foreground">
                    No recorded price history yet.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => onNavigate?.('battles')}
                className="h-9 rounded bg-background px-3 text-xs font-black text-foreground"
              >
                Challenge Fighter
              </button>
              <ActionButtons agent={agent} onNavigate={onNavigate} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function MarketplacePage({ onNavigate }: { onNavigate?: (section: AppSection) => void }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const { ensureOnchainWallet, wallets: connectedWallets, solanaWallets } = useEnsureOnchainWallet()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MarketFilter>('all')
  const [selectedAgent, setSelectedAgent] = useState<MarketplaceAgent | null>(null)
  const [selectedToolId, setSelectedToolId] = useState('')
  const [selectedToolModal, setSelectedToolModal] = useState<Gen1Tool | null>(null)
  const [showToolModal, setShowToolModal] = useState(false)
  const [activeTab, setActiveTab] = useState<'fighters' | 'buy-bc' | 'packs'>('packs')
  const [showPackModal, setShowPackModal] = useState(false)
  const [selectedPack, setSelectedPack] = useState<{
    title: string
    subtitle: string
    priceLabel: string
    detailsLabel: string
    details: string
    odds: string
    actionLabel: string
    actionVariant: 'default' | 'outline'
    disabled?: boolean
    packId?: string
  } | null>(null)
  const [listingQuantity, setListingQuantity] = useState(1)
  const [listingPrice, setListingPrice] = useState('0.1')
  const [listingCurrency, setListingCurrency] = useState('BNB')
  const [toolFilter, setToolFilter] = useState<'all' | 'common' | 'rare' | 'epic'>('all')
  const [sortBy, setSortBy] = useState<'price-low' | 'price-high' | 'usage'>('usage')
  const [isExecutingWalletAction, setIsExecutingWalletAction] = useState(false)
  const [showBcModal, setShowBcModal] = useState(false)
  const [selectedUsdAmount, setSelectedUsdAmount] = useState<number>(5)
  const [selectedTokenSymbol, setSelectedTokenSymbol] = useState<'USDT' | 'BNB'>('USDT')
  const [isPurchasingBc, setIsPurchasingBc] = useState(false)
  const [activePackInstanceId, setActivePackInstanceId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data, isLoading, isError, error } = useQuery<FighterProfilesFeed>({
    queryKey: ['/api/bantahbro/fighter-profiles', { limit: '160', refreshLive: 'true' }],
    staleTime: 20_000,
    refetchInterval: 45_000,
  })

  const viewerId = typeof (user as any)?.id === 'string' ? (user as any).id : null
  const { data: toolsData } = useGen1Tools()
  const { data: toolListingsData, isLoading: listingsLoading } = useGen1Listings()
  const { data: inventoryData } = useGen1Inventory(viewerId)
  const createListingMutation = useCreateGen1Listing()
  const cancelListingMutation = useCancelGen1Listing()
  const buyMutation = useBuyGen1Listing()
  const buyToolMutation = useBuyGen1Tool()
  const buyPackMutation = useBuyGen1Pack()
  const openPackMutation = useOpenGen1Pack()
  const [isProcessingPack, setIsProcessingPack] = useState(false)

  useEffect(() => {
    if (!selectedToolId && toolsData?.tools?.length) {
      setSelectedToolId(toolsData.tools[0].tool_id)
    }
  }, [selectedToolId, toolsData])

  const filteredAndSortedTools = useMemo(() => {
    let result = Array.isArray(toolsData?.tools) ? [...toolsData.tools] : []
    
    // Filter by tier
    if (toolFilter !== 'all') {
      result = result.filter((tool) => getToolRarity(tool) === toolFilter)
    }

    // Sort by rarity (epic first, then rare, then common)
    const rarityOrder = { epic: 0, rare: 1, common: 2 }
    result.sort((a, b) => rarityOrder[getToolRarity(a)] - rarityOrder[getToolRarity(b)])

    return result
  }, [toolsData?.tools, toolFilter, sortBy])

  const toolCounts = useMemo(() => {
    const allTools = Array.isArray(toolsData?.tools) ? toolsData.tools : []
    return {
      all: allTools.length,
      common: allTools.filter((tool) => getToolRarity(tool) === 'common').length,
      rare: allTools.filter((tool) => getToolRarity(tool) === 'rare').length,
      epic: allTools.filter((tool) => getToolRarity(tool) === 'epic').length,
    }
  }, [toolsData?.tools])

  const wallets = useMemo(() => viewerWallets(user), [user])
  const walletSet = useMemo(() => new Set(wallets), [wallets])
  const tools: Gen1Tool[] = Array.isArray(toolsData?.tools) ? toolsData.tools : []
  const inventoryRows: Gen1InventoryRow[] = Array.isArray(inventoryData?.inventory) ? inventoryData.inventory : []
  const inventoryByTool = useMemo(
    () =>
      inventoryRows.reduce<Record<string, Gen1InventoryRow>>(
        (acc, row) => {
          acc[row.tool_id] = row
          return acc
        },
        {},
      ),
    [inventoryRows],
  )
  const selectedTool = tools.find((tool) => tool.tool_id === selectedToolId) ?? null
  const modalTool = selectedToolModal ?? selectedTool
  const selectedToolInventory = selectedToolId ? inventoryByTool[selectedToolId] : null
  const toolListings: Gen1Listing[] = Array.isArray(toolListingsData?.listings) ? toolListingsData.listings : []
  const openToolListings = toolListings.filter((listing) => listing.status === 'open')
  const selectedToolListings = selectedToolId
    ? openToolListings.filter((listing) => listing.tool_id === selectedToolId)
    : openToolListings
  const selectedToolModalListings = modalTool?.tool_id ? openToolListings.filter((listing) => listing.tool_id === modalTool.tool_id) : selectedToolListings
  const selectedToolModalBcAmount = selectedToolModalListings.reduce(
    (sum, listing) => sum + ((parseFloat(listing.price_native) || 0) * (listing.quantity ?? 1)),
    0,
  )
  const selectedFallbackBuyNumeric = ((modalTool?.supply_total ?? 100) % 5) + 2
  const selectedToolModalBuyPrice = formatMoney(
    selectedToolModalListings[0] ? (parseFloat(selectedToolModalListings[0].price_native) || 0) : selectedFallbackBuyNumeric,
    selectedToolModalListings[0]?.token_symbol || 'USDC',
  )
  const myOpenToolListings = selectedToolListings.filter((listing) => listing.seller_user_id === viewerId)
  const agents = useMemo(
    () => (data?.profiles || []).map((profile) => profileToMarketplaceAgent(profile, walletSet, viewerId)),
    [data?.profiles, walletSet, viewerId],
  )
  const visibleAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return agents
      .filter((agent) => {
        if (filter === 'tradable' && !agent.canTrade) return false
        if (filter === 'ens' && agent.sourceKey !== 'ens') return false
        if (filter === 'virtuals' && agent.sourceKey !== 'virtuals') return false
        if (filter === 'eliza' && agent.sourceKey !== 'eliza') return false
        if (filter === 'nft' && agent.sourceKey !== 'nft') return false
        if (!normalizedQuery) return true
        return `${agent.name} ${agent.source}`.toLowerCase().includes(normalizedQuery)
      })
      .sort((left, right) => {
        if (left.listing.active !== right.listing.active) return left.listing.active ? -1 : 1
        return right.valueScore - left.valueScore
      })
  }, [agents, filter, query])

  const tradableAgents = agents.filter((agent) => agent.canTrade)
  const listedAgents = tradableAgents.filter((agent) => agent.listing.active)
  const listedValue = listedAgents.reduce((total, agent) => total + (agent.listing.price || 0), 0)

  const handleCreateListing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!viewerId) {
      toast({ title: 'Sign in required', description: 'Sign in to create a tool listing.', variant: 'destructive' })
      return
    }
    if (!selectedToolId) {
      toast({ title: 'Choose a tool', description: 'Select a tool to list before submitting.', variant: 'destructive' })
      return
    }
    if (listingQuantity < 1) {
      toast({ title: 'Invalid quantity', description: 'Quantity must be at least 1.', variant: 'destructive' })
      return
    }
    if ((selectedToolInventory?.quantity ?? 0) < listingQuantity) {
      toast({ title: 'Insufficient inventory', description: 'You do not have enough tool quantity.', variant: 'destructive' })
      return
    }

    createListingMutation.mutate(
      {
        listingId: `listing_${selectedToolId}_${Date.now()}`,
        toolId: selectedToolId,
        quantity: listingQuantity,
        priceNative: listingPrice,
        tokenSymbol: listingCurrency,
        expiresAt: null,
        metadata: { source: 'gen1' },
      },
      {
        onSuccess: () => {
          toast({ title: 'Listing created', description: 'Your tool is now listed on the Gen-1 market.' })
          setListingQuantity(1)
        },
        onError: (error: any) => {
          toast({ title: 'Listing failed', description: error?.message || 'Could not create listing.', variant: 'destructive' })
        },
      },
    )
  }

  const handleCancelListing = (listingId: string) => {
    cancelListingMutation.mutate(listingId, {
      onSuccess: () => {
        toast({ title: 'Listing canceled', description: 'Your Gen-1 listing has been removed.' })
      },
      onError: (error: any) => {
        toast({ title: 'Cancellation failed', description: error?.message || 'Could not cancel listing.', variant: 'destructive' })
      },
    })
  }

  return (
    <main className="flex-1 overflow-y-auto bg-background p-2 pb-24 text-foreground md:p-3 md:pb-3">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-2">
        <section className="overflow-hidden rounded-lg bg-card shadow-sm">
          <div className="relative min-h-[68px] overflow-hidden bg-[#170d31] px-3 py-2 text-white md:min-h-[68px] md:px-4 md:py-2">
            <img
              src="/assets/bota-app-thumbnail.jpg"
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-60"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#170d31]/95 via-[#170d31]/62 to-black/14" />
            <div className="relative z-10 flex h-full flex-col justify-center gap-1 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="inline-flex h-6 items-center gap-1.5 rounded bg-primary px-2 text-[9px] font-black uppercase text-primary-foreground md:h-6 md:gap-1.5 md:px-2 md:text-[9px]">
                  <Store size={12} />
                </div>
                <h1 className="mt-1 text-sm font-black uppercase leading-snug md:mt-1 md:text-2xl">
                  Season 1 Transfer Window
                </h1>
                <p className="mt-1 text-[10px] font-bold text-white/72 md:hidden">
                  {formatCompact(listedAgents.length)} listed · {formatMoney(listedValue)}
                </p>
                <p className="mt-1 hidden max-w-2xl text-[11px] font-semibold text-white/78 md:block">
                  Trade BOTA-owned fighter records. External API agents stay challenge-only.
                </p>
              </div>
              <div className="hidden grid-cols-3 gap-1 text-center text-[11px] md:grid">
                <div className="rounded bg-white/12 px-3 py-2 backdrop-blur">
                  <div className="text-lg font-black">Live</div>
                  <div className="text-[10px] font-bold uppercase text-white/65">Window</div>
                </div>
                <div className="rounded bg-white/12 px-3 py-2 backdrop-blur">
                  <div className="text-lg font-black">{formatMoney(listedValue)}</div>
                  <div className="text-[10px] font-bold uppercase text-white/65">Listed Value</div>
                </div>
                <div className="rounded bg-white/12 px-3 py-2 backdrop-blur">
                  <div className="text-lg font-black">{formatCompact(listedAgents.length)}</div>
                  <div className="text-[10px] font-bold uppercase text-white/65">Listed</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-lg bg-card p-2 shadow-sm">
          <div className="grid w-full grid-cols-5 gap-1">
            {['fighters', 'packs', 'buy-bc'].map((tab) => {
              const label = tab === 'fighters' ? 'FIGHTERS' : tab === 'buy-bc' ? 'BUY BC' : 'PACKS'
              return (
                <Button
                  key={tab}
                  type="button"
                  size="sm"
                  variant={activeTab === tab ? 'default' : 'outline'}
                  className="uppercase tracking-[.1em] font-black text-[9px] px-2 py-1 leading-none"
                  onClick={() => setActiveTab(tab as any)}
                >
                  {label}
                </Button>
              )
            })}
          </div>
        </section>

        {activeTab === 'fighters' ? (
          <section className="grid gap-2 md:grid-cols-[minmax(0,1.45fr)_auto] md:items-center">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
              <div className="flex min-h-10 max-w-[24rem] items-center gap-2 rounded-lg bg-card px-3">
                <Search size={16} className="text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search Fighters, ENS, Virtuals, Communities..."
                  className="h-9 min-w-0 w-full bg-transparent text-sm font-bold outline-none placeholder:text-muted-foreground"
                />
              </div>
              <button
                type="button"
                onClick={() => onNavigate?.('profile')}
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-primary px-4 text-sm font-black text-primary-foreground transition hover:bg-primary/90"
              >
                List Agent
              </button>
            </div>
            <div className="flex gap-1 overflow-x-auto rounded-lg bg-card p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setFilter(item.value)}
                  className={`h-9 shrink-0 rounded-md px-3 text-xs font-black uppercase transition ${
                    filter === item.value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-background hover:text-foreground'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>
        ) : activeTab === 'buy-bc' ? (
          <section className="rounded-lg bg-card p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-end">
              <div className="inline-flex items-center gap-2 rounded-md bg-accent/20 px-2 py-1 border border-border/50">
                <span className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">Pay with</span>
                <select value={selectedTokenSymbol} onChange={(e) => setSelectedTokenSymbol(e.target.value as any)} className="h-6 rounded bg-transparent text-[10px] font-black uppercase outline-none text-foreground">
                  <option value="USDT">USDT</option>
                  <option value="BNB">BNB</option>
                  <option value="SOL">SOL</option>
                </select>
              </div>
            </div>

            <div className="grid w-full grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
              {[1, 2, 3, 5, 8, 10, 15, 20, 25, 30, 50, 100].map((amt, index) => {
                const bcAmtMap: Record<number, string> = {
                  1: '10,000', 2: '21,000', 3: '32,000', 5: '55,000',
                  8: '90,000', 10: '120,000', 15: '185,000', 20: '250,000',
                  25: '320,000', 30: '390,000', 50: '650,000', 100: '1,500,000'
                }
                const bcAmt = bcAmtMap[amt] || '0'
                const isProcessingThis = isPurchasingBc && selectedUsdAmount === amt
                const diamondColors = ['text-emerald-400', 'text-sky-400', 'text-violet-400', 'text-fuchsia-400', 'text-amber-400']
                const diamondColor = diamondColors[index % diamondColors.length]
                
                return (
                  <div key={amt} className="overflow-hidden rounded-lg border border-border bg-background shadow-sm transition duration-200 hover:-translate-y-0.5 flex flex-col">
                    <div className="bg-primary/5 p-4 text-center">
                      <Gem className={`h-8 w-8 mx-auto mb-2 ${diamondColor}`} />
                      <div className="text-lg font-black text-foreground">{bcAmt}</div>
                      <div className="text-[10px] font-black uppercase tracking-[0.1em] text-muted-foreground">BantCredit</div>
                    </div>
                    <div className="p-3 mt-auto">
                      <Button
                        type="button"
                        variant="default"
                        className="w-full h-10 text-[11px] font-black uppercase tracking-wider"
                        onClick={async () => {
                          if (!viewerId) {
                            toast({ title: 'Sign in required', description: 'Sign in to purchase BantCredit.', variant: 'destructive' })
                            return
                          }
                          try {
                            setSelectedUsdAmount(amt)
                            setIsPurchasingBc(true)
                            const nativeAmount = String(amt)
                            const { result, resp } = await purchaseBcWithWallet({ ensureOnchainWallet, wallets: connectedWallets as any, solanaWallets: solanaWallets as any, usdAmount: amt, nativeAmount, tokenSymbol: selectedTokenSymbol })
                            queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] })
                            toast({ title: 'Purchase complete', description: `Minted ${resp?.addedBc || 'N/A'} BC.` })
                          } catch (error) {
                            const message = error instanceof Error ? error.message : 'Purchase failed'
                            toast({ title: 'Purchase failed', description: message, variant: 'destructive' })
                          } finally {
                            setIsPurchasingBc(false)
                          }
                        }}
                        disabled={isPurchasingBc}
                      >
                        {isProcessingThis ? <Loader2 className="animate-spin h-4 w-4 mx-auto" /> : `$${amt} USD`}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ) : activeTab === 'tools' ? (
          <section className="rounded-lg bg-card p-3 shadow-sm">
            <div className="mb-2 text-[10px] font-black uppercase text-muted-foreground">
              {formatCompact(filteredAndSortedTools.length)} tools · {formatCompact(openToolListings.length)} listings
            </div>

            <div className="space-y-2">
              {/* FILTERS & SORT */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {[
                    { value: 'all', label: 'All', count: toolCounts.all },
                    { value: 'common', label: 'Common', count: toolCounts.common },
                    { value: 'rare', label: 'Rare', count: toolCounts.rare },
                    { value: 'epic', label: 'Epic', count: toolCounts.epic },
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setToolFilter(item.value as any)}
                      className={`h-9 shrink-0 rounded-md px-3 text-xs font-black uppercase transition ${
                        toolFilter === item.value
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-background hover:text-foreground'
                      }`}
                    >
                      <span>{item.label}</span>
                      <span className="ml-2 inline-flex rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-black text-white">
                        {item.count}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-md border border-border bg-background px-2 text-muted-foreground transition hover:text-foreground"
                  aria-label="Change tool sort order"
                  onClick={() => {
                    const currentIndex = TOOL_SORT_OPTIONS.findIndex((option) => option.value === sortBy)
                    const nextIndex = (currentIndex + 1) % TOOL_SORT_OPTIONS.length
                    setSortBy(TOOL_SORT_OPTIONS[nextIndex].value as any)
                  }}
                >
                  <Filter className="h-4 w-4" />
                </button>
              </div>

              {/* TOOLS GRID */}
              <div className="grid w-full grid-cols-2 gap-2 lg:grid-cols-4">
                {(filteredAndSortedTools.length > 0 ? filteredAndSortedTools : TOOL_CATALOG_PLACEHOLDERS).map((tool) => {
                  const rarity = getToolRarity(tool as Gen1Tool)
                  const rarityColor =
                    rarity === 'epic' ? 'shadow-purple-500/15' : rarity === 'rare' ? 'shadow-sky-500/10' : 'shadow-emerald-500/10'
                  const rarityIcon =
                    rarity === 'epic' ? (
                      <Crown className="h-5 w-5 text-violet-400" />
                    ) : rarity === 'rare' ? (
                      <Shield className="h-5 w-5 text-sky-400" />
                    ) : (
                      <Star className="h-5 w-5 text-emerald-400" />
                    )
                  const toolListingsForTool = openToolListings.filter((l) => l.tool_id === tool.tool_id)
                  const toolBcAmount = toolListingsForTool.reduce(
                    (sum, listing) => sum + (parseFloat(listing.price_native) || 0) * (listing.quantity ?? 1),
                    0,
                  )
                  // deterministic mock buy price (2..6) when no listing exists
                  const fallbackBuyNumeric = ((tool.supply_total ?? 100) % 5) + 2
                  const toolBuyNumeric = toolListingsForTool[0]
                    ? parseFloat(toolListingsForTool[0].price_native) || 0
                    : fallbackBuyNumeric
                  const toolBuyPrice = formatMoney(toolBuyNumeric, toolListingsForTool[0]?.token_symbol || 'USDC')
                  const displayBcAmount = toolListingsForTool.length > 0
                    ? toolBcAmount
                    : Math.round(toolBuyNumeric * 1000 + ((tool.supply_total ?? 0) % 100))
                  const isPlaceholder = !Array.isArray(toolsData?.tools) || !(toolsData?.tools?.length > 0)

                  return (
                    <div
                      key={tool.tool_id}
                      role={!isPlaceholder ? 'button' : undefined}
                      tabIndex={!isPlaceholder ? 0 : undefined}
                      onClick={() => !isPlaceholder && setSelectedToolId(tool.tool_id)}
                      onKeyDown={(event) => {
                        if (!isPlaceholder && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault()
                          setSelectedToolId(tool.tool_id)
                        }
                      }}
                      className={`w-full overflow-hidden rounded-lg bg-card shadow-sm transition duration-200 hover:-translate-y-0.5 ${isPlaceholder ? 'cursor-default opacity-80' : 'hover:border-primary/30'} ${rarityColor}`}
                    >
                      <div className="relative h-24 overflow-hidden bg-background">
                        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950" />
                        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 to-transparent" />
                        <div className="absolute left-2 top-2 rounded-full bg-white/10 p-2 text-slate-200 shadow">
                          {rarityIcon}
                        </div>
                      </div>

                      <div className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h2 className="truncate text-sm font-black text-foreground">{tool.name}</h2>
                            <p className="truncate text-[11px] font-bold text-muted-foreground">Tool Module</p>
                          </div>
                          <div className="rounded bg-primary/12 px-2 py-1 text-[10px] font-black text-primary">
                            {formatCompact(tool.supply_total ?? 0)}
                          </div>
                        </div>

                        <div className="mt-2 grid grid-cols-3 gap-1 text-center">
                          <div className="rounded bg-background/70 px-2 py-1.5">
                            <div className="text-xs font-black text-foreground">{formatCompact(tool.supply_total ?? 0)}</div>
                            <div className="text-[9px] font-bold uppercase text-muted-foreground">Supply</div>
                          </div>
                          <div className="rounded bg-background/70 px-2 py-1.5">
                            <div className="text-xs font-black text-foreground">{formatCompact(toolListingsForTool.length)}</div>
                            <div className="text-[9px] font-bold uppercase text-muted-foreground">Listings</div>
                          </div>
                          <div className="rounded bg-background/70 px-2 py-1.5">
                            <div className="text-xs font-black text-foreground">{tool.description ? 'Info' : '-'}</div>
                            <div className="text-[9px] font-bold uppercase text-muted-foreground">Details</div>
                          </div>
                        </div>

                                <div className="mt-3 grid grid-cols-2 items-center gap-2">
                        <div className="min-w-0 rounded-lg bg-background/70 px-2 py-2 text-xs font-black text-foreground">
                          {`BC ${formatCompact(displayBcAmount)}`}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          className="w-full uppercase tracking-[0.14em] font-black py-2"
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelectedToolId(tool.tool_id)
                            setSelectedToolModal(tool as Gen1Tool)
                            setShowToolModal(true)
                          }}
                        >
                          Buy
                        </Button>
                      </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* TOOL DETAILS SIDEBAR */}
            {selectedTool ? (
              <div className="grid gap-4">
                {/* TOOL CARD */}
                <div className="space-y-4 rounded-[28px] border border-white/10 bg-slate-950/80 p-5 shadow-lg shadow-slate-950/30">
                  <div className="flex items-start justify-between gap-3">
                    <span
                      className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.28em] ${
                        getToolRarity(selectedTool) === 'epic'
                          ? 'bg-violet-600 text-white'
                          : getToolRarity(selectedTool) === 'rare'
                          ? 'bg-sky-500 text-white'
                          : 'bg-emerald-500 text-slate-950'
                      }`}
                    >
                      {getToolRarity(selectedTool)}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-xl font-black leading-tight text-white">{selectedTool.name}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-300">
                      {selectedTool.description || 'Advanced tactical arena module'}
                    </p>
                  </div>

                  {/* STATS */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-2xl bg-white/5 p-3">
                      <div className="font-bold uppercase text-slate-400">Supply</div>
                      <div className="mt-2 text-lg font-black text-white">{formatCompact(selectedTool.supply_total ?? 0)}</div>
                    </div>
                    <div className="rounded-2xl bg-white/5 p-3">
                      <div className="font-bold uppercase text-slate-400">Available</div>
                      <div className="mt-2 text-lg font-black text-white">{formatCompact(Math.max(0, (selectedTool.supply_total ?? 0) - (selectedToolListings.length * listingQuantity)))}</div>
                    </div>
                  </div>
                </div>

                {/* MARKET ACTIVITY */}
                <div className="space-y-3 rounded-[28px] border border-white/10 bg-slate-950/80 p-5 shadow-lg shadow-slate-950/30">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">Market Activity</div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-2xl bg-white/5 px-3 py-2">
                      <span className="text-xs font-bold text-slate-400">Last Sale</span>
                      <span className="text-sm font-black text-white">{selectedToolListings[0]?.price_native || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl bg-white/5 px-3 py-2">
                      <span className="text-xs font-bold text-slate-400">24h Volume</span>
                      <span className="text-sm font-black text-white">{formatCompact(selectedToolListings.reduce((sum, l) => sum + ((l.quantity ?? 0) * (parseFloat(l.price_native) || 0)), 0))}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl bg-white/5 px-3 py-2">
                      <span className="text-xs font-bold text-slate-400">Listings</span>
                      <span className="text-sm font-black text-white">{formatCompact(selectedToolListings.length)}</span>
                    </div>
                  </div>
                </div>

                {/* TOP USERS */}
                <div className="space-y-3 rounded-[28px] border border-white/10 bg-slate-950/80 p-5 shadow-lg shadow-slate-950/30">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">Top Users</div>
                  <div className="space-y-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
                        <div className="h-6 w-6 rounded-full bg-primary/30 shadow-md shadow-primary/20" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-black text-white">#{i + 1}</div>
                          <div className="text-[10px] text-slate-400">Agent using tool</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* BUY BUTTON */}
                <button
                  type="button"
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-4 font-black uppercase tracking-[0.16em] text-white transition hover:bg-violet-500 active:scale-95"
                  onClick={() => {
                    if (selectedTool) {
                      setSelectedToolModal(selectedTool)
                      setShowToolModal(true)
                    }
                  }}
                >
                  <Store size={16} />
                  Buy Tool
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeTab === 'fighters' ? (
          <>
            <section>
              <div className="grid w-full grid-cols-2 gap-1.5 md:grid-cols-2 xl:grid-cols-4">
                {visibleAgents.map((agent) => (
                  <FighterCard
                    key={agent.id}
                    agent={agent}
                    onNavigate={onNavigate}
                    onSelect={setSelectedAgent}
                  />
                ))}
              </div>
            </section>

            {isError ? (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm font-bold text-destructive">
                {error instanceof Error ? error.message : 'Marketplace data could not be loaded.'}
              </div>
            ) : null}

            {isLoading ? (
              <div className="rounded-lg bg-card p-4 text-sm font-bold text-muted-foreground">
                Loading marketplace fighters...
              </div>
            ) : !visibleAgents.length ? (
              <div className="rounded-lg bg-card p-4 text-sm font-bold text-muted-foreground">
                No matching fighters in the live profile feed.
              </div>
            ) : null}

            <section className="grid gap-2 md:grid-cols-4">
              <div className="rounded-lg bg-card p-3">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase text-muted-foreground">
                  <Users size={14} className="text-primary" />
                  Fighters
                </div>
                <div className="mt-2 text-xl font-black">{formatCompact(agents.length)}</div>
              </div>
              <div className="rounded-lg bg-card p-3">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase text-muted-foreground">
                  <BadgeDollarSign size={14} className="text-primary" />
                  Tradable
                </div>
                <div className="mt-2 text-xl font-black">{formatCompact(tradableAgents.length)}</div>
              </div>
              <div className="rounded-lg bg-card p-3">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase text-muted-foreground">
                  <Swords size={14} className="text-primary" />
                  Opponents
                </div>
                <div className="mt-2 text-xl font-black">{formatCompact(agents.filter((agent) => agent.isExternalApiAgent).length)}</div>
              </div>
              <div className="rounded-lg bg-card p-3">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase text-muted-foreground">
                  <Trophy size={14} className="text-primary" />
                  Listed Value
                </div>
                <div className="mt-2 text-xl font-black">{formatMoney(listedValue)}</div>
              </div>
            </section>
          </>
        ) : activeTab === 'packs' ? (
          <section className="rounded-lg bg-card p-3 shadow-sm">
            <div className="mb-3">
              <h2 className="text-[10px] font-black uppercase text-muted-foreground mb-1">🎁 Agent Supply Crates</h2>
              <p className="text-xs text-muted-foreground">Unknown upgrades for your autonomous fighter.</p>
            </div>
            <div className="grid w-full grid-cols-2 gap-1 sm:grid-cols-2 lg:grid-cols-4">
              {/* BantCredit Pack */}
              <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm transition duration-200 hover:-translate-y-0.5">
                <div className="flex h-full flex-col gap-1.5 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-xl">📦</div>
                        <div className="flex -space-x-1.5 opacity-90">
                          <div className="w-5 h-5 rounded-md bg-[#1e293b] border border-slate-700 flex items-center justify-center z-30 shadow-sm"><Shield size={10} className="text-amber-400" /></div>
                          <div className="w-5 h-5 rounded-md bg-[#1e293b] border border-slate-700 flex items-center justify-center z-20 shadow-sm"><Battery size={10} className="text-emerald-400" /></div>
                          <div className="w-5 h-5 rounded-md bg-[#1e293b] border border-slate-700 flex items-center justify-center z-10 shadow-sm"><Wrench size={10} className="text-slate-300" /></div>
                        </div>
                      </div>
                      <h3 className="mt-1 text-sm font-black uppercase tracking-[0.1em] text-foreground">BantCredit Pack</h3>
                      <p className="text-[9px] text-muted-foreground">Common Agent Crate</p>
                    </div>
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[8px] font-black uppercase text-emerald-400">500 BC</span>
                  </div>
                  <div className="text-[9px] leading-snug text-muted-foreground">
                    <span className="font-black uppercase tracking-[0.18em]">Contains</span>
                    <div className="mt-1">Enhancements • Doctrines • Traits</div>
                  </div>
                  <div className="text-[9px] leading-snug text-muted-foreground border-t border-border pt-2">
                    <span className="font-black uppercase tracking-[0.18em]">Odds</span>
                    <div className="mt-1">🟢 65% Common • 🔵 30% Rare • 🟣 5% Epic</div>
                  </div>
                  <Button
                    size="sm"
                    variant="default"
                    className="mt-auto w-full h-8 text-[9px] font-black uppercase tracking-[0.12em]"
                    onClick={() => {
                        setSelectedPack({
                        title: 'BantCredit Pack',
                          packId: 'tactical-pack',
                        subtitle: 'Common Agent Crate',
                        priceLabel: '500 BC',
                        detailsLabel: 'Contains',
                        details: 'Enhancements • Doctrines • Traits',
                        odds: '🟢 65% Common • 🔵 30% Rare • 🟣 5% Epic',
                        actionLabel: 'Open Pack',
                        actionVariant: 'default',
                      })
                      setShowPackModal(true)
                    }}
                  >
                    Open Pack
                  </Button>
                </div>
              </div>

              {/* Premium Pack */}
              <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm transition duration-200 hover:-translate-y-0.5">
                <div className="flex h-full flex-col gap-1.5 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-xl">💎📦</div>
                        <div className="flex -space-x-1.5 opacity-90">
                          <div className="w-5 h-5 rounded-md bg-[#1e293b] border border-slate-700 flex items-center justify-center z-30 shadow-sm"><Rocket size={10} className="text-rose-500" /></div>
                          <div className="w-5 h-5 rounded-md bg-[#1e293b] border border-slate-700 flex items-center justify-center z-20 shadow-sm"><Crosshair size={10} className="text-cyan-400" /></div>
                          <div className="w-5 h-5 rounded-md bg-[#1e293b] border border-slate-700 flex items-center justify-center z-10 shadow-sm"><Bot size={10} className="text-slate-300" /></div>
                        </div>
                      </div>
                      <h3 className="mt-1 text-sm font-black uppercase tracking-[0.1em] text-foreground">Premium Pack</h3>
                      <p className="text-[9px] text-muted-foreground">Enhanced Drop Rates</p>
                    </div>
                    <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[8px] font-black uppercase text-sky-400">120,000 BC</span>
                  </div>
                  <div className="text-[9px] leading-snug text-muted-foreground">
                    <span className="font-black uppercase tracking-[0.18em]">Contains</span>
                    <div className="mt-1">Rare Enhancements • Rare Doctrines • Traits</div>
                  </div>
                  <div className="text-[9px] leading-snug text-muted-foreground border-t border-border pt-2">
                    <span className="font-black uppercase tracking-[0.18em]">Odds</span>
                    <div className="mt-1">🟢 30% Common • 🔵 55% Rare • 🟣 15% Epic</div>
                  </div>
                  <Button
                    size="sm"
                    variant="default"
                    className="mt-auto w-full h-8 text-[9px] font-black uppercase tracking-[0.12em]"
                    onClick={() => {
                        setSelectedPack({
                        title: 'Premium Pack',
                          packId: 'elite-pack',
                        subtitle: 'Enhanced Drop Rates',
                        priceLabel: '120,000 BC',
                        detailsLabel: 'Contains',
                        details: 'Rare Enhancements • Rare Doctrines • Traits',
                        odds: '🟢 30% Common • 🔵 55% Rare • 🟣 15% Epic',
                        actionLabel: 'Buy Pack',
                        actionVariant: 'default',
                      })
                      setShowPackModal(true)
                    }}
                  >
                    Buy Pack
                  </Button>
                </div>
              </div>

              {/* Elite Pack */}
              <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm transition duration-200 hover:-translate-y-0.5">
                <div className="flex h-full flex-col gap-1.5 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-xl">⚡💎📦⚡</div>
                        <div className="flex -space-x-1.5 opacity-90">
                          <div className="w-5 h-5 rounded-md bg-[#1e293b] border border-slate-700 flex items-center justify-center z-30 shadow-sm"><PlusSquare size={10} className="text-emerald-500" /></div>
                          <div className="w-5 h-5 rounded-md bg-[#1e293b] border border-slate-700 flex items-center justify-center z-20 shadow-sm"><Satellite size={10} className="text-slate-400" /></div>
                          <div className="w-5 h-5 rounded-md bg-[#1e293b] border border-slate-700 flex items-center justify-center z-10 shadow-sm"><Rocket size={10} className="text-rose-500" /></div>
                        </div>
                      </div>
                      <h3 className="mt-1 text-sm font-black uppercase tracking-[0.1em] text-foreground">Elite Pack</h3>
                      <p className="text-[9px] text-muted-foreground">Competitive Tier Crate</p>
                    </div>
                    <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[8px] font-black uppercase text-violet-400">650,000 BC</span>
                  </div>
                  <div className="text-[9px] leading-snug text-muted-foreground">
                    <span className="font-black uppercase tracking-[0.18em]">Featured</span>
                    <div className="mt-1">Soul Harvester • Counter Analyzer • Dominion Core</div>
                  </div>
                  <div className="text-[9px] leading-snug text-muted-foreground border-t border-border pt-2">
                    <span className="font-black uppercase tracking-[0.18em]">Odds</span>
                    <div className="mt-1">🟢 10% Common • 🔵 65% Rare • 🟣 25% Epic</div>
                  </div>
                  <Button
                    size="sm"
                    variant="default"
                    className="mt-auto w-full h-8 text-[9px] font-black uppercase tracking-[0.12em]"
                    onClick={() => {
                        setSelectedPack({
                        title: 'Elite Pack',
                          packId: 'elite-pack',
                        subtitle: 'Competitive Tier Crate',
                        priceLabel: '650,000 BC',
                        detailsLabel: 'Featured',
                        details: 'Soul Harvester • Counter Analyzer • Dominion Core',
                        odds: '🟢 10% Common • 🔵 65% Rare • 🟣 25% Epic',
                        actionLabel: 'Buy Pack',
                        actionVariant: 'default',
                      })
                      setShowPackModal(true)
                    }}
                  >
                    Buy Pack
                  </Button>
                </div>
              </div>

              {/* Mythic Crate */}
              <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm transition duration-200 hover:-translate-y-0.5">
                <div className="flex h-full flex-col gap-1.5 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-xl">👑</div>
                        <div className="flex -space-x-1.5 opacity-90">
                          <div className="w-5 h-5 rounded-md bg-[#1e293b] border border-slate-700 flex items-center justify-center z-30 shadow-sm"><Crown size={10} className="text-amber-400" /></div>
                          <div className="w-5 h-5 rounded-md bg-[#1e293b] border border-slate-700 flex items-center justify-center z-20 shadow-sm"><Gem size={10} className="text-fuchsia-400" /></div>
                          <div className="w-5 h-5 rounded-md bg-[#1e293b] border border-slate-700 flex items-center justify-center z-10 shadow-sm"><Shield size={10} className="text-amber-400" /></div>
                        </div>
                      </div>
                      <h3 className="mt-1 text-sm font-black uppercase tracking-[0.1em] text-foreground">Mythic Crate</h3>
                      <p className="text-[9px] text-muted-foreground">Limited Supply</p>
                    </div>
                    <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[8px] font-black uppercase text-amber-400">Seasonal</span>
                  </div>
                  <div className="text-[9px] leading-snug text-muted-foreground">
                    <span className="font-black uppercase tracking-[0.18em]">Contains</span>
                    <div className="mt-1">Legendary Enhancements • Mythic Doctrines • Soul Traits</div>
                  </div>
                  <div className="text-[9px] leading-snug text-muted-foreground border-t border-border pt-2">
                    <span className="font-black uppercase tracking-[0.18em]">Odds</span>
                    <div className="mt-1">🔵 40% Rare • 🟣 50% Epic • ⭐ 10% Mythic</div>
                  </div>
                  <Button size="sm" variant="outline" className="mt-auto w-full h-8 text-[9px] font-black uppercase tracking-[0.12em]" disabled>
                    Sold Out
                  </Button>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
      <Dialog
        open={showBcModal}
        onOpenChange={(open) => setShowBcModal(open)}
      >
        <DialogContent className="bantahbro-next-ui w-[min(92vw,20rem)] max-w-[20rem] p-3">
          <DialogHeader>
            <DialogTitle className="text-sm font-black">Buy BantCredit (BC)</DialogTitle>
            <DialogDescription className="text-[11px] text-muted-foreground">Purchase BantCredit using your connected wallet. Pick an amount to mint BC at the bonus tier rates.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2 pt-2">
            <div className="grid grid-cols-1 gap-2">
              {[1,5,10,50,100].map((amt) => (
                <label key={amt} className={`flex items-center gap-2 rounded-md p-2 ${selectedUsdAmount===amt? 'bg-primary text-primary-foreground': 'bg-card'}`}>
                  <input type="radio" name="bc-amount" checked={selectedUsdAmount===amt} onChange={() => setSelectedUsdAmount(amt)} />
                  <div className="text-sm font-black">${amt} — {amt===1? '10,000 BC' : amt===5? '55,000 BC' : amt===10? '120,000 BC' : amt===50? '650,000 BC' : '1,500,000 BC'}</div>
                </label>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="text-[10px] font-black uppercase text-muted-foreground">Token</div>
              <select value={selectedTokenSymbol} onChange={(e) => setSelectedTokenSymbol(e.target.value as any)} className="ml-2 h-9 rounded-md border bg-background px-2 text-sm">
                <option value="USDT">USDT (recommended)</option>
                <option value="BNB">BNB (estimate required)</option>
              </select>
            </div>
          </div>

          <DialogFooter className="mt-3 gap-2">
            <Button type="button" variant="outline" className="w-full text-xs h-9" onClick={() => setShowBcModal(false)}>Cancel</Button>
            <Button
              type="button"
              variant="default"
              className="w-full text-xs h-9"
              onClick={async () => {
                if (!viewerId) {
                  toast({ title: 'Sign in required', description: 'Sign in to purchase BantCredit.', variant: 'destructive' })
                  return
                }
                try {
                  setIsPurchasingBc(true)
                  // for USDT we treat native amount as equal to USD amount (stable)
                  const nativeAmount = selectedTokenSymbol === 'USDT' ? String(selectedUsdAmount) : String(selectedUsdAmount)
                  const { result, resp } = await purchaseBcWithWallet({ ensureOnchainWallet, wallets: connectedWallets as any, solanaWallets: solanaWallets as any, usdAmount: selectedUsdAmount, nativeAmount, tokenSymbol: selectedTokenSymbol })
                  // refresh auth user to pick up new points
                  queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] })
                  toast({ title: 'Purchase complete', description: `Minted ${resp?.mintedBc || 'N/A'} BC. New balance: ${resp?.balance ?? 'N/A'}` })
                  setShowBcModal(false)
                } catch (error) {
                  const message = error instanceof Error ? error.message : 'Purchase failed'
                  toast({ title: 'Purchase failed', description: message, variant: 'destructive' })
                } finally {
                  setIsPurchasingBc(false)
                }
              }}
              disabled={isPurchasingBc}
            >
              {isPurchasingBc ? 'Processing...' : `Buy $${selectedUsdAmount}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showPackModal}
        onOpenChange={(open) => {
          setShowPackModal(open)
          if (!open) setSelectedPack(null)
        }}
      >
        <DialogContent className="bantahbro-next-ui w-[min(88vw,18rem)] max-w-[18rem] p-2.5">
          <DialogHeader>
            <DialogTitle className="text-sm font-black">{selectedPack?.title || 'Pack Details'}</DialogTitle>
            <DialogDescription className="text-[10px] text-muted-foreground">{selectedPack?.subtitle || 'Inspect this supply crate before opening.'}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2 pt-2 text-sm">
            <div className="rounded-md bg-card p-2.5">
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground">Reward</div>
              <div className="mt-1 text-base font-black">{selectedPack?.priceLabel}</div>
            </div>
            <div className="rounded-md bg-card p-2.5">
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground">{selectedPack?.detailsLabel}</div>
              <div className="mt-1 text-sm font-black leading-snug">{selectedPack?.details}</div>
            </div>
            <div className="rounded-md bg-card p-2.5">
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground">Odds</div>
              <div className="mt-1 text-sm font-black leading-snug">{selectedPack?.odds}</div>
            </div>
          </div>

          <DialogFooter className="mt-3 gap-2">
            <Button type="button" variant="outline" className="w-full text-xs h-9" onClick={() => setShowPackModal(false)}>
              Close
            </Button>
            <Button
              type="button"
              variant={selectedPack?.actionVariant || 'default'}
              className="w-full text-xs h-9"
              onClick={async () => {
                if (!viewerId) {
                  toast({ title: 'Sign in required', description: 'Sign in to open packs.', variant: 'destructive' })
                  return
                }
                if (!selectedPack?.packId) {
                  toast({ title: 'Pack missing', description: 'Pack id is unavailable', variant: 'destructive' })
                  return
                }
                
                setIsProcessingPack(true)
                try {
                  // Buy pack using BantCredit (BC)
                  const buyResp: any = await buyPackMutation.mutateAsync({ 
                    packId: selectedPack.packId, 
                    metadata: { source: 'ui', currency: 'bc' } 
                  })
                  
                  // normalize packInstanceId
                  const packInstanceId = buyResp?.packInstance?.packInstanceId || buyResp?.packInstanceId || (buyResp || {}).packInstanceId
                  if (!packInstanceId) {
                    toast({ title: 'Purchase failed', description: 'No pack instance returned', variant: 'destructive' })
                    return
                  }
                  
                  // Open pack modal with visual opener
                  setShowPackModal(false)
                  setActivePackInstanceId(packInstanceId)
                } catch (err: any) {
                  toast({ title: 'Pack operation failed', description: err?.message || 'Could not complete pack operation. Insufficient BC?', variant: 'destructive' })
                } finally {
                  setIsProcessingPack(false)
                }
              }}
              disabled={selectedPack?.disabled || isProcessingPack}
            >
              {isProcessingPack ? 'Processing...' : (selectedPack?.actionLabel || 'Open Pack')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showToolModal}
        onOpenChange={(open) => {
          setShowToolModal(open)
          if (!open) setSelectedToolModal(null)
        }}
      >
          <DialogContent className="bantahbro-next-ui w-[min(92vw,20rem)] max-w-[20rem] p-3">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between gap-2 text-sm font-black">
                <span className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-sm bg-accent/10 flex items-center justify-center text-accent">
                    {modalTool ? getToolIcon(modalTool) : <Shield className="h-4 w-4" />}
                  </div>
                  <span className="truncate text-sm">{modalTool?.name || 'Tool Details'}</span>
                </span>
              </DialogTitle>
              <DialogDescription className="text-[11px] text-muted-foreground">
                {modalTool?.description || 'View the tool details and purchase options.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between rounded-md bg-card p-2">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Rarity</span>
                <span className="text-xs font-black text-foreground">{modalTool ? getToolRarity(modalTool) : 'common'}</span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs">
                <div className="rounded-md bg-card p-2">
                  <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Supply</div>
                  <div className="mt-1 text-sm font-black text-foreground">{formatCompact(modalTool?.supply_total ?? 0)}</div>
                </div>
                <div className="rounded-md bg-card p-2">
                  <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Listings</div>
                  <div className="mt-1 text-sm font-black text-foreground">{formatCompact(selectedToolModalListings.length)}</div>
                </div>
              </div>
              <div className="rounded-md bg-card p-2 text-xs">
                <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">BC</div>
                <div className="mt-1 font-black text-foreground">
                  {selectedToolModalListings.length > 0
                    ? `BC ${formatCompact(selectedToolModalBcAmount)}`
                    : `BC ${formatCompact(0)}`}
                </div>
                {selectedToolModalBuyPrice ? (
                  <div className="mt-1 text-[10px] text-muted-foreground">{selectedToolModalBuyPrice}</div>
                ) : null}
              </div>
            </div>

            <DialogFooter className="mt-3 gap-2">
              <Button type="button" variant="outline" className="w-full text-xs h-9" onClick={() => setShowToolModal(false)}>
                Close
              </Button>
              <Button
                type="button"
                variant="default"
                className="w-full text-xs h-9"
                onClick={async () => {
                  if (!viewerId) {
                    toast({ title: 'Sign in required', description: 'Sign in to purchase tools.', variant: 'destructive' })
                    return
                  }

                  const listing = selectedToolModalListings[0]
                  if (listing) {
                    buyMutation.mutate(listing.listing_id, {
                      onSuccess: () => {
                        toast({ title: 'Purchase recorded', description: 'Your purchase was recorded.' })
                        setShowToolModal(false)
                      },
                      onError: (error: any) => {
                        toast({ title: 'Purchase failed', description: error?.message || 'Could not complete purchase.', variant: 'destructive' })
                      },
                    })
                    return
                  }

                  if (!selectedToolModal) {
                    toast({ title: 'Tool missing', description: 'Tool details are unavailable.', variant: 'destructive' })
                    return
                  }

                  // Execute wallet action for native token purchase
                  try {
                    setIsExecutingWalletAction(true)

                    // Ensure user is authenticated and has a connected wallet
                    const { walletAddress } = await ensureOnchainWallet('purchase tools')

                    // Fetch onchain config
                    const onchainConfig = (await apiRequest('GET', '/api/onchain/config')) as OnchainPublicConfig

                    // Build native send action for tool purchase
                    const walletAction: BantahBroWalletAction = {
                      kind: 'send',
                      chainId: onchainConfig.defaultChainId,
                      chainLabel: onchainConfig.defaultChainId === 8453 ? 'Base' : 'BNB Chain',
                      tokenQuery: onchainConfig.defaultChainId === 8453 ? 'ETH' : 'BNB',
                      amount: String(selectedFallbackBuyNumeric),
                      recipientAddress: 'bantah.bro', // Will be resolved by prepareBantahBroWalletAction
                      recipientLabel: 'Bantah.bro',
                      summary: `Purchase ${selectedToolModal.name}`,
                    }

                    // Prepare the wallet action
                    const preparedResponse = (await apiRequest('POST', '/api/bantahbro/wallet-actions/prepare', {
                      action: walletAction,
                      walletAddress,
                    })) as { action: BantahBroPreparedWalletAction }

                    // Execute the prepared action
                    const result = await executeBantahBroPreparedWalletAction({
                      wallets: connectedWallets as any,
                      preferredWalletAddress: walletAddress,
                      onchainConfig,
                      action: preparedResponse.action,
                    })

                    // Now perform the purchase with the transaction hash
                    buyToolMutation.mutate(
                      {
                        toolId: selectedToolModal.tool_id,
                        purchaseId: `purchase_${selectedToolModal.tool_id}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
                        quantity: 1,
                        priceNative: String(selectedFallbackBuyNumeric),
                        tokenSymbol: selectedToolModalListings[0]?.token_symbol || 'BNB',
                        paymentTxHash: result.txHash,
                        metadata: { source: 'native_direct', walletAddress, chainId: result.chainId },
                      },
                      {
                        onSuccess: () => {
                          toast({ 
                            title: 'Tool purchased', 
                            description: `Your purchase was recorded. Transaction: ${result.txHash}` 
                          })
                          setShowToolModal(false)
                        },
                        onError: (error: any) => {
                          toast({ title: 'Purchase failed', description: error?.message || 'Could not complete purchase.', variant: 'destructive' })
                        },
                      },
                    )
                  } catch (error) {
                    setIsExecutingWalletAction(false)
                    const errorMessage = error instanceof Error ? error.message : 'Wallet execution failed'
                    toast({ title: 'Wallet error', description: errorMessage, variant: 'destructive' })
                  }
                }}
                disabled={Boolean((buyMutation as any)?.isLoading || (buyToolMutation as any)?.isLoading || isExecutingWalletAction)}
              >
                {isExecutingWalletAction ? 'Executing wallet action...' : (selectedToolModalBuyPrice ? `Buy ${selectedToolModalBuyPrice}` : 'Buy Now')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      {selectedAgent ? (
        <FighterDetailOverlay
          agent={selectedAgent!}
          onClose={() => setSelectedAgent(null)}
          onNavigate={onNavigate}
        />
      ) : null}

      {activePackInstanceId && (
        <BotaPackOpener
          packInstanceId={activePackInstanceId}
          onClose={() => setActivePackInstanceId(null)}
        />
      )}
    </main>
  )
}
