import { useState, useMemo, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Share2, 
  Copy, 
  Link, 
  ExternalLink, 
  Users,
  Download,
  Calendar,
  MessageSquare,
  Award,
  Megaphone,
  BarChart3,
  MousePointerClick
} from 'lucide-react';
import { SiX, SiHive } from 'react-icons/si';
import type { GroupConversationCache } from '@shared/schema';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow, format, differenceInDays } from 'date-fns';

interface PromotionToolsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: GroupConversationCache[];
  currentUsername?: string;
}

interface ReferralData {
  refCode: string;
  joinedMembers: string[];
  clickCount: number;
}

interface ReferralStore {
  [groupId: string]: ReferralData[];
}

const REFERRAL_CLICKS_KEY = 'hive-messenger-referral-clicks';

export function PromotionTools({
  open,
  onOpenChange,
  groups,
  currentUsername,
}: PromotionToolsProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [referralData, setReferralData] = useState<ReferralStore>({});
  const { toast } = useToast();

  const creatorGroups = useMemo(() => {
    return groups.filter(g => g.creator === currentUsername);
  }, [groups, currentUsername]);

  const selectedGroup = useMemo(() => {
    if (!selectedGroupId && creatorGroups.length > 0) {
      return creatorGroups[0];
    }
    return creatorGroups.find(g => g.groupId === selectedGroupId) || creatorGroups[0];
  }, [creatorGroups, selectedGroupId]);

  const loadReferralData = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(REFERRAL_CLICKS_KEY);
      setReferralData(stored ? JSON.parse(stored) : {});
    } catch {
      setReferralData({});
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadReferralData();
    }
  }, [open, loadReferralData]);

  const generateShareableLink = (groupId: string, withRef = false) => {
    const baseUrl = `${window.location.origin}/#/join/${groupId}`;
    if (withRef && currentUsername) {
      return `${baseUrl}?ref=${currentUsername}`;
    }
    return baseUrl;
  };

  const generateShareMessage = (group: GroupConversationCache, link: string) => {
    let message = `Join my group '${group.name}' on Hive Messenger! ${link}`;
    if (group.paymentSettings?.enabled && group.paymentSettings.amount) {
      message = `Join my premium group '${group.name}' on Hive Messenger for just ${group.paymentSettings.amount} HBD! ${link}`;
    }
    return message;
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: `${label} copied to clipboard`,
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Please copy manually",
        variant: "destructive",
      });
    }
  };

  const shareToTwitter = (group: GroupConversationCache) => {
    const link = generateShareableLink(group.groupId, true);
    const message = generateShareMessage(group, link);
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`;
    window.open(twitterUrl, '_blank');
  };

  const shareToHive = (group: GroupConversationCache) => {
    const link = generateShareableLink(group.groupId, true);
    const title = `Join ${group.name} on Hive Messenger`;
    const body = generateShareMessage(group, link);
    const tags = 'hive,messenger,community,group';
    const peakdUrl = `https://peakd.com/submit?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&tags=${encodeURIComponent(tags)}`;
    window.open(peakdUrl, '_blank');
  };

  const getGroupStats = (group: GroupConversationCache) => {
    const createdAt = new Date(group.createdAt);
    const ageInDays = differenceInDays(new Date(), createdAt);
    
    return {
      memberCount: group.members.length,
      messageCount: (group as GroupConversationCache & { messageCount?: number }).messageCount || 0,
      age: ageInDays,
      ageText: formatDistanceToNow(createdAt, { addSuffix: false }),
      isPaid: group.paymentSettings?.enabled || false,
      price: group.paymentSettings?.amount || '0',
    };
  };

  const generateBadgeText = (group: GroupConversationCache) => {
    const stats = getGroupStats(group);
    if (stats.isPaid) {
      return `${group.name} | ${stats.memberCount} members | ${stats.price} HBD`;
    }
    return `${group.name} | ${stats.memberCount} members | ${stats.ageText} old`;
  };

  const exportReferralCSV = () => {
    if (!selectedGroup) return;
    
    const groupReferrals = referralData[selectedGroup.groupId] || [];
    if (groupReferrals.length === 0) {
      toast({
        title: "No data to export",
        description: "No referral data available for this group",
        variant: "destructive",
      });
      return;
    }

    const headers = ['Referral Code', 'Click Count', 'Joined Members'];
    const rows = groupReferrals.map(ref => [
      ref.refCode,
      ref.clickCount.toString(),
      ref.joinedMembers.join('; '),
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `referrals_${selectedGroup.name}_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast({
      title: "Exported!",
      description: "Referral data downloaded as CSV",
    });
  };

  const totalReferralStats = useMemo(() => {
    if (!selectedGroup) return { totalClicks: 0, totalMembers: 0, sources: 0 };
    
    const groupReferrals = referralData[selectedGroup.groupId] || [];
    return {
      totalClicks: groupReferrals.reduce((sum, r) => sum + r.clickCount, 0),
      totalMembers: groupReferrals.reduce((sum, r) => sum + r.joinedMembers.length, 0),
      sources: groupReferrals.length,
    };
  }, [selectedGroup, referralData]);

  if (creatorGroups.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-promotion-tools">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-primary" />
              Promotion Tools
            </DialogTitle>
            <DialogDescription>
              Marketing and sharing tools for your groups
            </DialogDescription>
          </DialogHeader>
          <div className="text-center py-12">
            <Share2 className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">No Groups to Promote</p>
            <p className="text-muted-foreground">Create a group first to access promotion tools</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" data-testid="dialog-promotion-tools">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-primary" />
            Promotion Tools
          </DialogTitle>
          <DialogDescription>
            Share and promote your groups to grow your community
          </DialogDescription>
        </DialogHeader>

        <div className="mb-4">
          <Select 
            value={selectedGroup?.groupId || ''} 
            onValueChange={setSelectedGroupId}
          >
            <SelectTrigger className="w-full" data-testid="select-group">
              <SelectValue placeholder="Select a group" />
            </SelectTrigger>
            <SelectContent>
              {creatorGroups.map(g => (
                <SelectItem key={g.groupId} value={g.groupId}>
                  <span className="flex items-center gap-2">
                    {g.name}
                    {g.paymentSettings?.enabled && (
                      <Badge variant="secondary" className="text-xs">Paid</Badge>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedGroup && (
          <Tabs defaultValue="links" className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="grid w-full grid-cols-4" data-testid="tabs-promotion">
              <TabsTrigger value="links" data-testid="tab-links">
                <Link className="w-4 h-4 mr-1" />
                Links
              </TabsTrigger>
              <TabsTrigger value="social" data-testid="tab-social">
                <Share2 className="w-4 h-4 mr-1" />
                Social
              </TabsTrigger>
              <TabsTrigger value="referrals" data-testid="tab-referrals">
                <MousePointerClick className="w-4 h-4 mr-1" />
                Referrals
              </TabsTrigger>
              <TabsTrigger value="stats" data-testid="tab-stats">
                <BarChart3 className="w-4 h-4 mr-1" />
                Stats
              </TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 mt-4">
              <TabsContent value="links" className="space-y-4 m-0">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Link className="w-4 h-4" />
                      Direct Link
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Input
                        value={generateShareableLink(selectedGroup.groupId)}
                        readOnly
                        className="flex-1 text-sm"
                        data-testid="input-direct-link"
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => copyToClipboard(
                          generateShareableLink(selectedGroup.groupId),
                          "Direct link"
                        )}
                        data-testid="button-copy-direct-link"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Share this link to let anyone join "{selectedGroup.name}"
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Referral Link
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Input
                        value={generateShareableLink(selectedGroup.groupId, true)}
                        readOnly
                        className="flex-1 text-sm"
                        data-testid="input-referral-link"
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => copyToClipboard(
                          generateShareableLink(selectedGroup.groupId, true),
                          "Referral link"
                        )}
                        data-testid="button-copy-referral-link"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Track who joins through your personal referral code
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="social" className="space-y-4 m-0">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Share Message</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="p-3 bg-muted rounded-md text-sm" data-testid="text-share-message">
                      {generateShareMessage(selectedGroup, generateShareableLink(selectedGroup.groupId, true))}
                    </div>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => copyToClipboard(
                        generateShareMessage(selectedGroup, generateShareableLink(selectedGroup.groupId, true)),
                        "Share message"
                      )}
                      data-testid="button-copy-message"
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Message
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Quick Share</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => shareToTwitter(selectedGroup)}
                      data-testid="button-share-twitter"
                    >
                      <SiX className="w-4 h-4 mr-2" />
                      Share on X (Twitter)
                      <ExternalLink className="w-3 h-3 ml-auto" />
                    </Button>
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => shareToHive(selectedGroup)}
                      data-testid="button-share-hive"
                    >
                      <SiHive className="w-4 h-4 mr-2" />
                      Post on Hive (PeakD)
                      <ExternalLink className="w-3 h-3 ml-auto" />
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="referrals" className="space-y-4 m-0">
                <div className="grid grid-cols-3 gap-3">
                  <Card>
                    <CardContent className="pt-4 text-center">
                      <MousePointerClick className="w-6 h-6 mx-auto mb-1 text-primary" />
                      <p className="text-2xl font-bold" data-testid="text-total-clicks">
                        {totalReferralStats.totalClicks}
                      </p>
                      <p className="text-xs text-muted-foreground">Total Clicks</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 text-center">
                      <Users className="w-6 h-6 mx-auto mb-1 text-primary" />
                      <p className="text-2xl font-bold" data-testid="text-total-joins">
                        {totalReferralStats.totalMembers}
                      </p>
                      <p className="text-xs text-muted-foreground">Members Joined</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 text-center">
                      <Link className="w-6 h-6 mx-auto mb-1 text-primary" />
                      <p className="text-2xl font-bold" data-testid="text-total-sources">
                        {totalReferralStats.sources}
                      </p>
                      <p className="text-xs text-muted-foreground">Sources</p>
                    </CardContent>
                  </Card>
                </div>

                {(referralData[selectedGroup.groupId]?.length || 0) > 0 ? (
                  <>
                    <Card>
                      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                        <CardTitle className="text-sm font-medium">Referral Sources</CardTitle>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={exportReferralCSV}
                          data-testid="button-export-referrals"
                        >
                          <Download className="w-4 h-4 mr-1" />
                          Export CSV
                        </Button>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {referralData[selectedGroup.groupId]?.map((ref, idx) => (
                            <div 
                              key={idx}
                              className="flex items-center justify-between p-2 bg-muted rounded-md"
                              data-testid={`referral-row-${idx}`}
                            >
                              <div>
                                <p className="font-medium text-sm">{ref.refCode}</p>
                                <p className="text-xs text-muted-foreground">
                                  {ref.joinedMembers.length} member{ref.joinedMembers.length !== 1 ? 's' : ''} joined
                                </p>
                              </div>
                              <Badge variant="secondary">
                                {ref.clickCount} click{ref.clickCount !== 1 ? 's' : ''}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <Card>
                    <CardContent className="py-8 text-center">
                      <MousePointerClick className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="font-medium">No Referrals Yet</p>
                      <p className="text-sm text-muted-foreground">
                        Share your referral link to start tracking who brings new members
                      </p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="stats" className="space-y-4 m-0">
                {(() => {
                  const stats = getGroupStats(selectedGroup);
                  return (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        <Card>
                          <CardContent className="pt-4 text-center">
                            <Users className="w-6 h-6 mx-auto mb-1 text-primary" />
                            <p className="text-2xl font-bold" data-testid="text-member-count">
                              {stats.memberCount}
                            </p>
                            <p className="text-xs text-muted-foreground">Members</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="pt-4 text-center">
                            <MessageSquare className="w-6 h-6 mx-auto mb-1 text-primary" />
                            <p className="text-2xl font-bold" data-testid="text-message-count">
                              {stats.messageCount}
                            </p>
                            <p className="text-xs text-muted-foreground">Messages</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="pt-4 text-center">
                            <Calendar className="w-6 h-6 mx-auto mb-1 text-primary" />
                            <p className="text-2xl font-bold" data-testid="text-group-age">
                              {stats.age}
                            </p>
                            <p className="text-xs text-muted-foreground">Days Old</p>
                          </CardContent>
                        </Card>
                      </div>

                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Award className="w-4 h-4" />
                            Badge Text for Bio
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="p-3 bg-muted rounded-md text-sm font-mono" data-testid="text-badge">
                            {generateBadgeText(selectedGroup)}
                          </div>
                          <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => copyToClipboard(
                              generateBadgeText(selectedGroup),
                              "Badge text"
                            )}
                            data-testid="button-copy-badge"
                          >
                            <Copy className="w-4 h-4 mr-2" />
                            Copy Badge Text
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            Add this to your social media bios to promote your group
                          </p>
                        </CardContent>
                      </Card>

                      {stats.isPaid && (
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium">Paid Group Info</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">Price</span>
                              <Badge data-testid="text-group-price">{stats.price} HBD</Badge>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </>
                  );
                })()}
              </TabsContent>
            </ScrollArea>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
