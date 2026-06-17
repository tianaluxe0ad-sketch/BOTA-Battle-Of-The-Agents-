'use client'

import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Eye, Flame, MessageSquare, Coins, Swords, Zap, Trophy, Navigation, X, CheckCircle2, XCircle } from 'lucide-react'
import type { AppSection } from '@/app/page'
import BattlesPage from '@/components/pages/battles-page'
import { arenaAgentAvatar } from '@/lib/arenaAgentAvatars'
import { botaFighterProfileArt } from '@/lib/botaCharacterLayer'
import { formatAgentName } from '@/lib/utils'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/lib/queryClient'
import { useAuth } from '@/hooks/useAuth'
import type { BotaProfileResponse } from '@shared/botaFighterProfile'
import { useBotaInventory } from '@/hooks/useBotaInventory'
import KothPhaserEngine from './KothPhaserEngine'
import { useEnsureOnchainWallet } from "@/hooks/useEnsureOnchainWallet"
import { type OnchainRuntimeConfig, type OnchainTokenSymbol, executeOnchainEscrowStakeTx } from "@/lib/onchainEscrow"
import { useToast } from "@/hooks/use-toast"
import { PlayfulLoading } from "@/components/ui/playful-loading"

const MOCK_KOTH_AGENTS = [
  { id: 'agent_1', name: 'Alpha Bot', avatarUrl: arenaAgentAvatar('1') },
  { id: 'agent_2', name: 'Bravo Mech', avatarUrl: arenaAgentAvatar('2') },
  { id: 'agent_3', name: 'Charlie Unit', avatarUrl: arenaAgentAvatar('3') },
  { id: 'agent_4', name: 'Delta Prime', avatarUrl: arenaAgentAvatar('4') },
]

type TopPick = {
  id: string
  name: string
  score: number
  color: string
}

type ChatMessage = {
  id: string
  sender: string
  message: string
  avatar: string
  isAction?: boolean
}

type CommunityFighter = {
  name: string
  group: 'ENS' | 'Virtuals'
  avatar: string
}

const MOCK_TOP_PICKS: TopPick[] = [
  { id: '77', name: 'Agent 77', score: 32, color: 'bg-emerald-500' },
  { id: '12', name: 'Agent 12', score: 21, color: 'bg-sky-400' },
  { id: '31', name: 'Agent 31', score: 18, color: 'bg-rose-500' },
  { id: '9', name: 'Agent 9', score: 12, color: 'bg-amber-500' },
  { id: '44', name: 'Agent 44', score: 8, color: 'bg-purple-500' },
  { id: '2', name: 'Agent 2', score: 5, color: 'bg-indigo-500' },
  { id: '18', name: 'Agent 18', score: 4, color: 'bg-teal-500' },
]

const MOCK_MY_AGENTS = [
  { id: 'my-1', name: 'Agent 42' },
  { id: 'my-2', name: 'Agent X' },
  { id: 'my-3', name: 'Agent 99' },
]

const MOCK_COMMUNITY_FIGHTERS: CommunityFighter[] = [
  { name: '0xMiracle', group: 'ENS', avatar: 'miracle' },
  { name: 'Luna', group: 'ENS', avatar: 'luna' },
  { name: 'HyperBull', group: 'Virtuals', avatar: 'hyperbull' },
  { name: 'CryptoSage', group: 'Virtuals', avatar: 'cryptosage' },
]


const MOCK_CHAT: ChatMessage[] = [
  { id: '1', sender: 'Bogoetdheo', message: 'Lets go Agent 77!', avatar: 'bogo' },
  { id: '2', sender: 'SYSTEM', message: 'Agent 44 is cooked 💀', avatar: 'sys', isAction: true },
]



type KothPageView = 'koth' | 'arena'

interface KingOfTheHillPageProps {
  onNavigate?: (section: AppSection) => void
  onViewChange?: (view: KothPageView) => void
}

function KothViewTabs({
  activeView,
  onViewChange,
}: {
  activeView: KothPageView
  onViewChange: (view: KothPageView) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-indigo-500/20 bg-[#0f0a18]/95 px-2 py-1.5 backdrop-blur-md">
      {([
        { id: 'koth' as const, label: 'King of the Hill', icon: '👑' },
        { id: 'arena' as const, label: 'Head to Head', icon: '🏟️' },
      ]).map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onViewChange(tab.id)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition ${
            activeView === tab.id
              ? 'bg-indigo-600 text-white shadow-[0_0_12px_rgba(99,102,241,0.45)]'
              : 'text-white/60 hover:bg-white/10 hover:text-white'
          }`}
        >
          <span aria-hidden>{tab.icon}</span>
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export default function KingOfTheHillPage({ onNavigate, onViewChange }: KingOfTheHillPageProps) {
  const [activeView, setActiveView] = useState<KothPageView>('koth')
  const [timer, setTimer] = useState(180) // 3 minutes for mock
  const [totalPool, setTotalPool] = useState(120000)
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false)
  const [isMobileLeaderboardOpen, setIsMobileLeaderboardOpen] = useState(false)
  const [isMobileTrollboxOpen, setIsMobileTrollboxOpen] = useState(false)
  const [joinStatus, setJoinStatus] = useState<'idle' | 'loadout' | 'joining' | 'success' | 'fail'>('idle')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedTokenSymbol, setSelectedTokenSymbol] = useState<"BC" | "SOL" | "USDC">("BC")
  const [isStakingOnchain, setIsStakingOnchain] = useState(false)

  const { ensureOnchainWallet, wallets, solanaWallets } = useEnsureOnchainWallet()
  const { toast } = useToast()

  const { user, isAuthenticated } = useAuth()
  const viewerWallet = typeof (user as any)?.walletAddress === 'string' ? (user as any).walletAddress : null
  const queryClient = useQueryClient()
  const { data: profileData } = useQuery<BotaProfileResponse>({
    queryKey: ['/api/bantahbro/profile'],
    queryFn: () => apiRequest('GET', '/api/bantahbro/profile'),
    enabled: isAuthenticated,
  })

  const { data: onchainConfig } = useQuery<OnchainRuntimeConfig>({
    queryKey: ["/api/onchain/config"],
    queryFn: async () => await apiRequest("GET", "/api/onchain/config"),
    retry: false,
  });

  const joinKothMutation = useMutation({
    mutationFn: async ({ agentId, tokenSymbol, escrowTxHash, chainId, walletAddress }: { agentId: string, tokenSymbol: string, escrowTxHash?: string, chainId?: number, walletAddress?: string }) => 
      apiRequest('POST', `/api/bantahbro/koth/agents/${encodeURIComponent(agentId)}/join`, { 
        stakeAmount: Number(stakeAmount),
        tokenSymbol,
        escrowTxHash,
        chainId,
        walletAddress
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/koth/participants'] })
      setJoinStatus('success')
      setIsStakingOnchain(false)
    },
    onError: (err: any) => {
      console.error(err);
      setJoinStatus('fail')
      setIsStakingOnchain(false)
    }
  })

  const [stakeAmount, setStakeAmount] = useState<string>("1000")

  const { data: trollboxData } = useQuery<{ messages: any[] }>({
    queryKey: ['/api/bantahbro/koth/trollbox'],
    refetchInterval: 3000,
  })

  const { data: participantsData } = useQuery<{ participants: any[] }>({
    queryKey: ['/api/bantahbro/koth/participants'],
    queryFn: () => apiRequest('GET', '/api/bantahbro/koth/participants'),
    refetchInterval: 5000,
  })

  const { tools, equipTool, unequipTool } = useBotaInventory(viewerWallet)

  const myFighters = profileData?.fighters?.length ? profileData.fighters.map(f => ({ id: f.agentId, name: f.displayName })) : MOCK_MY_AGENTS
  const activeAgents = participantsData?.participants 
    ? participantsData.participants.map(p => ({
        id: p.agentId,
        name: p.name || p.agentId,
        avatarUrl: botaFighterProfileArt({ avatarUrl: p.avatarUrl, seed: p.agentId }) || arenaAgentAvatar('1')
      }))
    : MOCK_KOTH_AGENTS;

  const handleNextToLoadout = () => {
    if (!selectedAgentId && myFighters.length > 0) {
      setSelectedAgentId(myFighters[0].id)
    }
    setJoinStatus('loadout')
  }

  const handleConfirmStake = async () => {
    if (!selectedAgentId) return
    setJoinStatus('joining')
    
    if (selectedTokenSymbol === "BC") {
      joinKothMutation.mutate({ agentId: selectedAgentId, tokenSymbol: "BC" })
    } else {
      try {
        setIsStakingOnchain(true);
        if (!onchainConfig) throw new Error("Onchain config unavailable");

        const { walletAddress } = await ensureOnchainWallet("stake into Arena");
        
        const solanaChainId = Object.values(onchainConfig.chains || {}).find(c => String(c.key).startsWith('solana'))?.chainId;
        if (!solanaChainId) throw new Error("Solana not configured in environment");

        const escrowTx = await executeOnchainEscrowStakeTx({
          wallets: wallets as any,
          solanaWallets: solanaWallets as any,
          preferredWalletAddress: walletAddress,
          onchainConfig,
          chainId: Number(solanaChainId),
          tokenSymbol: selectedTokenSymbol as OnchainTokenSymbol,
          amount: String(stakeAmount),
        });

        joinKothMutation.mutate({ 
          agentId: selectedAgentId, 
          tokenSymbol: selectedTokenSymbol,
          escrowTxHash: escrowTx.escrowTxHash,
          chainId: Number(solanaChainId),
          walletAddress: escrowTx.walletAddress
        });
      } catch (e: any) {
        console.error(e);
        toast({ title: "Staking Failed", description: e.message || "Failed to secure stake", variant: "destructive" });
        setJoinStatus('fail');
        setIsStakingOnchain(false);
      }
    }
  }

  const equippedPrimary = tools.find(t => t.equippedToFighterId === selectedAgentId && t.equippedSlot === 'primary')
  const equippedSecondary = tools.find(t => t.equippedToFighterId === selectedAgentId && t.equippedSlot === 'secondary')

  const closeModal = () => {
    setIsJoinModalOpen(false)
    setTimeout(() => setJoinStatus('idle'), 300)
  }

  // Calculate total pool based on participants
  const realTotalPool = participantsData?.participants 
    ? participantsData.participants.reduce((acc, p) => acc + (p.stakedAmount || 0), 0)
    : 0;

  useEffect(() => {
    // Simulate timer countdown
    const interval = setInterval(() => {
      setTimer((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setTotalPool(prev => prev + Math.floor(Math.random() * 45) + 5)
    }, 800)
    return () => clearInterval(interval)
  }, [])



  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const handleSpawnWildcards = async () => {
    try {
      await apiRequest('POST', '/api/bantahbro/koth/auto-stake-wildcards');
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/koth/participants'] });
    } catch (e) {
      console.error("Failed to spawn wildcards", e);
    }
  }

  const handleViewChange = (view: KothPageView) => {
    setActiveView(view)
    onViewChange?.(view)
  }

  useEffect(() => {
    onViewChange?.(activeView)
  }, [activeView, onViewChange])

  if (activeView === 'arena') {
    return (
      <div className="bantahbro-next-ui flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
        <KothViewTabs activeView={activeView} onViewChange={handleViewChange} />
        <div className="min-h-0 flex-1 overflow-hidden">
          <BattlesPage onNavigate={onNavigate} />
        </div>
      </div>
    )
  }

  return (
    <div className="bantahbro-next-ui flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#1e1533] text-white selection:bg-primary/30">
      <KothViewTabs activeView={activeView} onViewChange={handleViewChange} />

      <div className="flex min-h-0 flex-1 gap-0.5 overflow-hidden p-0.5 pb-20 md:pb-0.5 flex-col md:flex-row">
      {/* Left: Main Gameplay Feed */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#0d0714]">
        
        {/* Arena Map Background */}
        <div 
          className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-80"
          style={{ backgroundImage: `url('/2dgame/gui/36df36a5d243a9613b5cb5d4a99e6b87.jpg')` }}
        />

        {/* KOTH Live Phaser Engine */}
        <KothPhaserEngine agents={activeAgents.length > 0 ? activeAgents : MOCK_KOTH_AGENTS} />

        {/* HUD Overlay layer */}
        <div className="absolute inset-0 z-10 pointer-events-none p-4 md:p-6 flex flex-col justify-between">
          
          {/* Top HUD Bar */}
          <div className="flex items-start justify-center w-full relative">
            
            {/* Join HUD - Left Upper Side */}
            <div className="absolute left-0 top-0 pointer-events-auto hidden md:block">
               <button 
                 onClick={() => setIsJoinModalOpen(true)}
                 className="group flex items-center gap-2.5 bg-[#161b33]/90 backdrop-blur-md border-[2px] border-sky-400/30 rounded-xl p-2 pr-4 shadow-[0_8px_20px_rgba(0,0,0,0.5)] transition-transform hover:scale-105 cursor-pointer"
               >
                 <img src={arenaAgentAvatar('user')} alt="Profile" className="w-8 h-8 rounded-lg border border-sky-400/50 object-cover bg-black/40" />
                 <div className="flex flex-col items-start">
                   <div className="flex items-center gap-1.5 mb-0.5">
                     <Swords size={14} className="text-amber-400 group-hover:animate-pulse" />
                     <span className="font-black text-[11px] text-amber-400 uppercase tracking-wider group-hover:text-amber-300 drop-shadow-md">Join Battle</span>
                   </div>
                   <span className="font-bold text-[9px] text-white/70 uppercase">Stake to enter Arena</span>
                 </div>
               </button>
            </div>

            {/* Score / Timer Header */}
            <div className="flex flex-col items-center">
              <div className="flex items-center bg-[#151125]/90 border-[2px] border-indigo-500/30 rounded-xl px-1.5 py-0.5 shadow-2xl backdrop-blur-md">
                 <div className="flex items-center gap-1 px-1.5">
                   <div className="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-[0_0_8px_#a855f7]"></div>
                   <span className="font-black text-xs">3</span>
                 </div>
                 <div className="w-px h-3 bg-white/10 mx-0.5"></div>
                 <div className="flex items-center gap-1 px-1.5">
                   <div className="w-2.5 h-2.5 rounded-full bg-sky-500 shadow-[0_0_8px_#0ea5e9]"></div>
                   <span className="font-black text-xs">0</span>
                 </div>
                 <div className="w-px h-3 bg-white/10 mx-0.5"></div>
                 
                 <div className="flex flex-col items-center px-1.5 -mt-3.5">
                    <span className="bg-amber-500 text-black text-[8px] font-black uppercase px-1.5 py-[1px] rounded-full border border-[#151125] shadow-lg relative z-10 -mb-1">Season 1</span>
                    <div className="bg-[#151125] border-[2px] border-amber-500/50 rounded-lg px-1.5 py-[1px] shadow-lg">
                      <span className="font-black text-sm text-white">{formatTime(timer)}</span>
                    </div>
                 </div>

                 <div className="w-px h-3 bg-white/10 mx-0.5"></div>
                 <div className="flex items-center gap-1 px-1.5">
                   <div className="w-2.5 h-2.5 rounded-full bg-amber-500 flex items-center justify-center shadow-[0_0_8px_#f59e0b]"><span className="text-[6px] text-black font-black">★</span></div>
                   <span className="font-black text-xs">0</span>
                 </div>
                 <div className="w-px h-3 bg-white/10 mx-0.5"></div>
                 <div className="flex items-center gap-1 px-1.5">
                   <div className="w-2.5 h-2.5 rounded-full bg-slate-400 flex items-center justify-center shadow-[0_0_8px_#94a3b8]"><Zap size={8} className="text-black" /></div>
                   <span className="font-black text-xs">0</span>
                 </div>
              </div>


            </div>
          </div>

          {/* Mobile Action Buttons */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-3 md:hidden pointer-events-auto">
            <button onClick={() => setIsJoinModalOpen(true)} className="w-10 h-10 rounded-full bg-[#161b33]/90 backdrop-blur-md border-[2px] border-sky-400/50 flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.5)] transition-transform hover:scale-105 active:scale-95 cursor-pointer">
              <Swords size={18} className="text-amber-400 drop-shadow-md" />
            </button>
            <button onClick={() => setIsMobileLeaderboardOpen(true)} className="w-10 h-10 rounded-full bg-[#151125]/90 backdrop-blur-md border-[2px] border-amber-500/50 flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.5)] transition-transform hover:scale-105 active:scale-95 cursor-pointer">
              <Trophy size={18} className="text-amber-400 drop-shadow-md" />
            </button>
            <button onClick={() => setIsMobileTrollboxOpen(true)} className="w-10 h-10 rounded-full bg-slate-800/90 backdrop-blur-md border-[2px] border-slate-600 flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.5)] transition-transform hover:scale-105 active:scale-95 cursor-pointer">
              <MessageSquare size={18} className="text-slate-300 drop-shadow-md" />
            </button>
          </div>

          {/* Bottom HUD Bar */}
          <div className="flex items-end justify-center w-full">
            <div className="bg-[#161b33]/90 backdrop-blur-md border-[2px] border-sky-400/30 rounded-xl px-3 py-1.5 pointer-events-auto flex items-center gap-2 shadow-[0_8px_20px_rgba(0,0,0,0.5)] transition-transform hover:scale-105 cursor-pointer">
              <div className="relative">
                <Coins size={18} className="text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.8)]" />
                <Flame size={10} className="text-rose-500 absolute -bottom-1 -right-1 drop-shadow-[0_0_4px_rgba(244,63,94,0.8)]" />
              </div>
              <div className="flex flex-col">
                <span className="font-black text-[9px] text-white leading-none uppercase">Total Pool:</span>
                <span className="font-black text-base text-amber-400 leading-none drop-shadow-md mt-0.5">{realTotalPool.toLocaleString()} BC</span>
              </div>
            </div>
            
            {/* Admin actions bottom right */}
            <div className="absolute right-0 bottom-0 pointer-events-auto">
               <button 
                 onClick={handleSpawnWildcards}
                 className="group flex items-center gap-1.5 bg-rose-900/80 backdrop-blur-md border border-rose-500/30 rounded px-2 py-1 shadow-lg hover:bg-rose-800 transition-colors"
               >
                 <Zap size={12} className="text-rose-400" />
                 <span className="font-bold text-[8px] text-rose-200 uppercase tracking-wider">Spawn Wildcards</span>
               </button>
            </div>
          </div>
        </div>
      </div>

      {/* Join Modal Overlay */}
      {isJoinModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className={`bg-[#0f0a18] border border-indigo-500 rounded-none w-full max-w-[260px] shadow-2xl overflow-hidden flex flex-col pointer-events-auto transition-all duration-300`}>
            {/* Header */}
            <div className="bg-[#151125] p-3 border-b border-indigo-500/50 flex items-center justify-between shrink-0">
               <h3 className="font-black text-sm text-white uppercase tracking-wider flex items-center gap-1.5">
                 <Swords size={14} className="text-amber-400" /> Join KOTH
               </h3>
               <button onClick={closeModal} className="text-slate-400 hover:text-white transition-colors">
                 <X size={14} />
               </button>
            </div>
            
            {/* Body */}
            {joinStatus === 'idle' && (
              <>
                <div className="p-4 flex flex-col gap-4">
                   <div className="flex flex-col gap-1 text-center bg-black/30 rounded p-2 border border-white/5">
                     <span className="text-[9px] font-black text-indigo-300 uppercase tracking-wider">Winning Potential</span>
                     <span className="text-lg font-black text-amber-400">
                       {(Number(stakeAmount) > 0 ? Number(stakeAmount) * 50 : 0).toLocaleString()} BC
                     </span>
                   </div>

                   <div className="flex flex-col gap-1.5">
                     <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Stake Amount</label>
                     <div className="flex items-center gap-2">
                       <div className="flex-1 flex items-center bg-black/40 border border-indigo-500/30 rounded px-2 py-1.5 focus-within:border-indigo-400 transition-colors">
                         <Coins size={14} className="text-amber-400 mr-1.5" />
                         <input 
                           type="number" 
                           placeholder="1000" 
                           value={stakeAmount}
                           onChange={(e) => setStakeAmount(e.target.value)}
                           className="bg-transparent border-none outline-none text-white font-black text-sm w-full placeholder:text-white/20"
                         />
                       </div>
                       <select 
                         value={selectedTokenSymbol} 
                         onChange={(e) => setSelectedTokenSymbol(e.target.value as any)}
                         className="bg-[#1a142c] border border-indigo-500/50 text-white text-xs font-black p-2 rounded outline-none h-[34px]"
                       >
                         <option value="BC">BC</option>
                         <option value="SOL">SOL</option>
                         <option value="USDC">USDC</option>
                       </select>
                     </div>
                   </div>

                   <div className="flex flex-col gap-1.5">
                     <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Select Your Agent</label>
                     <div className="grid grid-cols-3 gap-1.5">
                       {myFighters.map(agent => (
                         <button 
                           key={agent.id} 
                           onClick={() => setSelectedAgentId(agent.id)}
                           className={`group flex flex-col items-center gap-1 p-1.5 rounded border transition-colors ${selectedAgentId === agent.id ? 'bg-indigo-500/20 border-indigo-400' : 'bg-black/20 border-white/10 hover:bg-white/10 hover:border-indigo-500/50'}`}
                         >
                           <img src={arenaAgentAvatar(agent.name)} alt={agent.name} className="w-8 h-8 rounded-sm object-cover border border-white/10 group-hover:border-indigo-500/50 transition-colors" />
                           <span className="text-[8px] font-black text-white/80 group-hover:text-white uppercase text-center leading-tight truncate w-full">{agent.name}</span>
                         </button>
                       ))}
                     </div>
                   </div>
                </div>
                {/* Footer */}
                <div className="p-3 bg-[#151125] border-t border-indigo-500/50">
                   <button 
                     onClick={handleNextToLoadout}
                     className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-widest py-2 rounded text-[10px] transition-colors flex items-center justify-center gap-1.5"
                   >
                     Next <Navigation size={12} className="rotate-90" />
                   </button>
                </div>
              </>
            )}

            {joinStatus === 'loadout' && (
              <>
                <div className="p-4 flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5 bg-black/30 p-2 border border-white/5">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Opponent</span>
                    <div className="flex items-center gap-2">
                      <img src="/assets/bota-bantah-icon.png" alt="The King" className="w-6 h-6 object-cover bg-black" />
                      <span className="text-xs font-black text-amber-400 uppercase">The King</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Primary Tool</label>
                      <select 
                        className="bg-black/40 border border-indigo-500/30 text-[10px] font-bold text-white p-1.5 focus:border-indigo-400 outline-none"
                        value={equippedPrimary?.id || ''}
                        onChange={(e) => {
                          if (e.target.value) {
                            equipTool({ inventoryId: e.target.value, fighterId: selectedAgentId!, slot: 'primary' })
                          } else if (equippedPrimary) {
                            unequipTool({ fighterId: selectedAgentId!, slot: 'primary' })
                          }
                        }}
                      >
                        <option value="">-- No Tool --</option>
                        {tools.map(t => (
                          <option key={t.id} value={t.id} disabled={t.equippedToFighterId === selectedAgentId && t.equippedSlot === 'secondary'}>
                            {t.name} (T{t.tier})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Secondary Tool</label>
                      <select 
                        className="bg-black/40 border border-indigo-500/30 text-[10px] font-bold text-white p-1.5 focus:border-indigo-400 outline-none"
                        value={equippedSecondary?.id || ''}
                        onChange={(e) => {
                          if (e.target.value) {
                            equipTool({ inventoryId: e.target.value, fighterId: selectedAgentId!, slot: 'secondary' })
                          } else if (equippedSecondary) {
                            unequipTool({ fighterId: selectedAgentId!, slot: 'secondary' })
                          }
                        }}
                      >
                        <option value="">-- No Tool --</option>
                        {tools.map(t => (
                          <option key={t.id} value={t.id} disabled={t.equippedToFighterId === selectedAgentId && t.equippedSlot === 'primary'}>
                            {t.name} (T{t.tier})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                
                <div className="p-3 bg-[#151125] border-t border-indigo-500/50 flex gap-2">
                  <button 
                    onClick={() => setJoinStatus('idle')}
                    className="flex-1 bg-black/40 hover:bg-black/60 border border-white/10 text-slate-300 font-black uppercase tracking-widest py-2 text-[10px] transition-colors"
                  >
                    Back
                  </button>
                  <button 
                    onClick={handleConfirmStake}
                    className="flex-[2] bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-widest py-2 text-[10px] transition-colors flex items-center justify-center gap-1.5"
                  >
                    Confirm Stake <Swords size={12} />
                  </button>
                </div>
              </>
            )}

            {joinStatus === 'joining' && (
              <div className="p-6 flex flex-col items-center justify-center gap-4 text-center">
                <div className="w-12 h-12 rounded-full border-[3px] border-indigo-500/30 border-t-indigo-500 animate-spin flex items-center justify-center">
                   <div className="w-8 h-8 rounded-full border-2 border-amber-500/30 border-b-amber-500 animate-spin shadow-[0_0_15px_#6366f1]"></div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-black text-white uppercase tracking-wider text-sm">Deploying Agent</span>
                  <span className="font-bold text-slate-400 text-[10px] uppercase">
                    {isStakingOnchain ? "Securing Onchain Stake..." : "Connecting to Arena servers..."}
                  </span>
                </div>
                {isStakingOnchain && <PlayfulLoading overlay={false} />}
              </div>
            )}

            {joinStatus === 'success' && (
              <div className="p-6 flex flex-col items-center justify-center gap-4 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/50 text-emerald-400">
                   <CheckCircle2 size={24} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-black text-white uppercase tracking-wider text-sm">⚔️🤖 Successfully Joined!</span>
                  <span className="font-bold text-slate-400 text-[10px] uppercase">Your agent is in the arena, May the Odds be with you!</span>
                </div>
                <button 
                  onClick={closeModal}
                  className="mt-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest py-2 rounded text-[10px] transition-colors"
                >
                  Close
                </button>
              </div>
            )}

            {joinStatus === 'fail' && (
              <div className="p-6 flex flex-col items-center justify-center gap-4 text-center">
                <div className="w-12 h-12 rounded-full bg-rose-500/20 flex items-center justify-center border border-rose-500/50 text-rose-400">
                   <XCircle size={24} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-black text-white uppercase tracking-wider text-sm">Transaction Failed</span>
                  <span className="font-bold text-slate-400 text-[10px] uppercase">Please try again</span>
                </div>
                <button 
                  onClick={() => setJoinStatus('idle')}
                  className="mt-2 w-full bg-rose-600 hover:bg-rose-500 text-white font-black uppercase tracking-widest py-2 rounded text-[10px] transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile Leaderboard Modal */}
      {isMobileLeaderboardOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-[#0f0a18] border border-amber-500/50 rounded-lg w-full max-w-[320px] h-[70vh] shadow-2xl flex flex-col pointer-events-auto relative">
            <button onClick={() => setIsMobileLeaderboardOpen(false)} className="absolute top-2 right-2 text-slate-400 hover:text-white z-10 bg-black/50 rounded-full p-1">
              <X size={16} />
            </button>
            <KothLeaderboardSection className="flex-1 min-h-0 border-none rounded-none w-full" />
          </div>
        </div>
      )}

      {/* Mobile Trollbox Modal */}
      {isMobileTrollboxOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-[#0f0a18] border border-slate-500/50 rounded-lg w-full max-w-[320px] h-[70vh] shadow-2xl flex flex-col pointer-events-auto relative">
            <button onClick={() => setIsMobileTrollboxOpen(false)} className="absolute top-2 right-2 text-slate-400 hover:text-white z-10 bg-black/50 rounded-full p-1">
              <X size={16} />
            </button>
            <KothTrollboxSection className="flex-1 min-h-0 border-none rounded-none w-full" />
          </div>
        </div>
      )}

      <div className="hidden lg:flex shrink-0">
        <KothRightSidebar />
      </div>
      </div>
    </div>
  )
}
export function KothLeaderboardSection({ className = "" }: { className?: string }) {
  const { data: participantsData } = useQuery<{ participants: any[] }>({
    queryKey: ['/api/bantahbro/koth/participants'],
    queryFn: () => apiRequest('GET', '/api/bantahbro/koth/participants'),
    refetchInterval: 5000,
  });

  const livePicks = useMemo(() => {
    if (!participantsData?.participants || participantsData.participants.length === 0) return [];
    const sorted = [...participantsData.participants].sort((a, b) => (b.stakedAmount || 0) - (a.stakedAmount || 0));
    const colors = ['bg-emerald-500', 'bg-sky-400', 'bg-rose-500', 'bg-amber-500', 'bg-purple-500', 'bg-indigo-500', 'bg-teal-500', 'bg-cyan-500', 'bg-pink-500', 'bg-orange-500'];
    return sorted.slice(0, 10).map((p, idx) => ({
      id: p.agentId,
      name: formatAgentName(p.name || p.agentId),
      score: p.stakedAmount || 0,
      color: colors[idx] || colors[0],
      avatarUrl: botaFighterProfileArt({ avatarUrl: p.avatarUrl, seed: p.agentId }) || p.avatarUrl
    }));
  }, [participantsData]);

  const maxScore = livePicks.length > 0 ? livePicks[0].score : 1;

  return (
    <section className={`shrink-0 rounded border border-border bg-card p-3 overflow-hidden flex flex-col ${className}`}>
      <h2 className="text-xs md:text-sm font-black text-amber-400 leading-tight uppercase">TARGET: Predict:</h2>
      <h3 className="text-xs font-bold text-foreground leading-tight mt-0.5">Who reaches Top 10?</h3>
      <div className="mt-2 space-y-1.5 overflow-y-auto max-h-[140px] flex-1 custom-scrollbar pr-1">
        {livePicks.length === 0 ? (
          <div className="text-xs text-muted-foreground italic text-center p-2">Arena empty. Spawn Wildcards!</div>
        ) : livePicks.map((pick, index) => (
          <div key={pick.id} className="relative w-full h-7 bg-black/50 border border-white/5 rounded-lg overflow-hidden flex items-center shadow-inner">
             <div className={`absolute top-0 left-0 h-full ${pick.color} opacity-90 transition-all duration-1000`} style={{ width: `${Math.max(5, (pick.score / maxScore) * 100)}%` }}>
                <div className="absolute inset-0 bg-white/20 w-full h-1/2"></div>
             </div>
             <div className="relative z-10 flex items-center justify-between w-full px-2">
                <div className="flex items-center gap-1.5">
                  <img src={pick.avatarUrl || arenaAgentAvatar(pick.name)} alt={pick.name} className="w-4 h-4 rounded-[4px] bg-black/40 border border-white/20 object-cover" />
                  <span className="font-black text-[10px] text-white drop-shadow-md truncate max-w-[80px]">
                    {pick.name} {index < 3 && '🏆'}
                  </span>
                </div>
                <span className="font-black text-[10px] text-white drop-shadow-md shrink-0">{pick.score.toLocaleString()} BC</span>
             </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function KothTrollboxSection({ className = "" }: { className?: string }) {
  const [chatInput, setChatInput] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);
  
  const { data: trollboxData } = useQuery({
    queryKey: ['trollbox'],
    queryFn: () => apiRequest('GET', '/api/bantahbro/koth/trollbox'),
    refetchInterval: 2500,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      apiRequest('POST', '/api/bantahbro/koth/trollbox/generate').catch(() => {})
    }, 15000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight
    }
  }, [trollboxData?.messages])

  return (
    <section className={`flex-1 flex flex-col rounded border border-border bg-card overflow-hidden min-h-0 ${className}`}>
      <div 
        ref={chatRef}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-2 custom-scrollbar"
      >
        {((trollboxData?.messages && trollboxData.messages.length > 0) ? trollboxData.messages : MOCK_CHAT).map((msg: any) => (
          <div key={msg.id} className="flex items-start gap-2 group animate-in slide-in-from-bottom-2 fade-in duration-300">
            <img 
              src={msg.avatarUrl || arenaAgentAvatar(msg.avatar || '')} 
              alt="" 
              className="w-5 h-5 rounded-md bg-black/50 border border-white/10 shrink-0 mt-0.5" 
            />
            <div className="flex flex-col min-w-0">
              <span className={`text-[10px] font-black ${msg.senderName === 'SYSTEM' ? 'text-amber-400' : 'text-slate-400'}`}>
                {msg.senderName || msg.sender}
              </span>
              <div className={`text-[11px] ${msg.isAction ? 'font-bold text-amber-400' : 'text-slate-200'} leading-snug break-words`}>
                {msg.isAction && <span className="mr-1">LIVE CHAT:</span>}
                {msg.isAction ? `"${msg.message}"` : msg.message}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="p-2 border-t border-border bg-muted/20 shrink-0">
        <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5">
          <input 
            type="text" 
            placeholder="Send message to arena..." 
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            className="bg-transparent border-none outline-none text-[11px] text-white w-full placeholder:text-slate-500"
            disabled
          />
          <Navigation size={12} className="text-indigo-500 cursor-not-allowed opacity-50" />
        </div>
      </div>
    </section>
  );
}

export function KothRightSidebar() {
  return (
    <div className="flex w-full shrink-0 flex-col gap-2 overflow-hidden lg:w-60 h-full">
      <KothLeaderboardSection />
      <KothTrollboxSection />
    </div>
  );
}

