'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useAgentManagement } from '@/hooks/useAgentManagement';
import { Edit2, Save, X } from 'lucide-react';

interface AgentEditorProps {
  agentId: string;
  initialName: string;
  initialAvatar?: string;
  onSave?: () => void;
}

export function AgentEditor({ agentId, initialName, initialAvatar, onSave }: AgentEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatar || '');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { updateAgent, isUpdating } = useAgentManagement();

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
        setAvatarUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    updateAgent(agentId, {
      agentName: name,
      avatarUrl: avatarUrl || undefined,
    });
    setIsEditing(false);
    onSave?.();
  };

  const displayUrl = previewUrl || initialAvatar;

  if (!isEditing) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-3">
            <Avatar className="w-12 h-12">
              <AvatarImage src={displayUrl} />
              <AvatarFallback>{initialName.charAt(0)}</AvatarFallback>
            </Avatar>
            {initialName}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
            className="gap-2"
          >
            <Edit2 className="w-4 h-4" />
            Edit
          </Button>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit Agent</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Avatar Preview */}
        <div className="flex flex-col items-center gap-3">
          <Avatar className="w-20 h-20">
            <AvatarImage src={displayUrl} />
            <AvatarFallback>{name.charAt(0)}</AvatarFallback>
          </Avatar>
          <Button variant="outline" size="sm" asChild>
            <label className="cursor-pointer">
              Change Avatar
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
              />
            </label>
          </Button>
        </div>

        {/* Agent Name */}
        <div className="space-y-2">
          <Label htmlFor="agent-name">Agent Name</Label>
          <Input
            id="agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter agent name"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            disabled={isUpdating || name === initialName}
            className="gap-2"
          >
            <Save className="w-4 h-4" />
            Save Changes
          </Button>
          <Button variant="outline" onClick={() => setIsEditing(false)} className="gap-2">
            <X className="w-4 h-4" />
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
