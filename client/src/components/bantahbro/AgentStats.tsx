'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Coins, TrendingUp } from 'lucide-react';

interface AgentStatsProps {
  agentName: string;
  wins: number;
  losses: number;
  totalBC: number;
  totalUSDT: number;
  spectatorshipBC?: number;
}

export function AgentStats({
  agentName,
  wins,
  losses,
  totalBC,
  totalUSDT,
  spectatorshipBC = 0,
}: AgentStatsProps) {
  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Record */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Battle Record</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-green-600 font-semibold">Wins: {wins}</span>
            <Badge variant="outline" className="bg-green-50">
              {winRate}%
            </Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-red-600 font-semibold">Losses: {losses}</span>
          </div>
        </CardContent>
      </Card>

      {/* Earnings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Total Earnings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-yellow-600" />
            <span className="font-semibold">{totalBC.toLocaleString()} BC</span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-600" />
            <span className="font-semibold">${totalUSDT.toFixed(2)} USDT</span>
          </div>
        </CardContent>
      </Card>

      {/* Spectatorship BC */}
      {spectatorshipBC > 0 && (
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Spectatorship Earnings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-purple-600" />
              <span className="font-semibold text-purple-600">
                {spectatorshipBC.toLocaleString()} BC
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
