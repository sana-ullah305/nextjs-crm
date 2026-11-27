"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCompactCurrency, formatDate, formatDateTime } from "@/lib/format";
import { quotationApi, salesOrderApi, dealApi, type Deal, type Quotation, type SalesOrder } from "@/lib/api-client";
import { useRouter } from "next/navigation";

type DealDetailClientProps = {
  initialDeal: Deal;
};

function statusBadge(status: string) {
  const variants: Record<string, "default" | "success" | "destructive" | "outline" | "secondary"> = {
    DRAFT: "secondary",
    SENT: "default",
    ACCEPTED: "success",
    REJECTED: "destructive",
    EXPIRED: "outline",
    PENDING: "secondary",
    CONFIRMED: "default",
    COMPLETED: "success",
    CANCELLED: "destructive",
  };
  return variants[status] ?? "default";
}

export function DealDetailClient({ initialDeal }: DealDetailClientProps) {
  const router = useRouter();
  const [deal] = useState<Deal>(initialDeal);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [loadingQuotations, setLoadingQuotations] = useState(false);
  const [loadingSalesOrders, setLoadingSalesOrders] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const isOpen = deal.status === "OPEN";
  const wonStage = useMemo(() => deal.pipeline?.stages?.find((s) => s.type === "WON"), [deal.pipeline]);
  const lostStage = useMemo(() => deal.pipeline?.stages?.find((s) => s.type === "LOST"), [deal.pipeline]);

  // Load quotations
  const loadQuotations = useCallback(async () => {
    setLoadingQuotations(true);
    try {
      const res = await quotationApi.list({ dealId: deal.id, pageSize: 50 });
      setQuotations(res.quotations);
    } catch (e) {
      console.error("Failed to load quotations:", e);
    } finally {
      setLoadingQuotations(false);
    }
  }, [deal.id]);

  // Load sales orders
  const loadSalesOrders = useCallback(async () => {
    setLoadingSalesOrders(true);
    try {
      const res = await salesOrderApi.list({ dealId: deal.id, pageSize: 50 });
      setSalesOrders(res.salesOrders);
    } catch (e) {
      console.error("Failed to load sales orders:", e);
    } finally {
      setLoadingSalesOrders(false);
    }
  }, [deal.id]);

  useEffect(() => {
    loadQuotations();
    loadSalesOrders();
  }, [loadQuotations, loadSalesOrders]);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    loadQuotations();
    loadSalesOrders();
  }, [loadQuotations, loadSalesOrders]);

  // Quotation dialog state
  const [quoDialogOpen, setQuoDialogOpen] = useState(false);
  const [quoNumber, setQuoNumber] = useState("");
  const [quoValidUntil, setQuoValidUntil] = useState("");
  const [quoNotes, setQuoNotes] = useState("");
  const [quoSubmitting, setQuoSubmitting] = useState(false);

  const handleCreateQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuoSubmitting(true);
    try {
      await quotationApi.create({
        quotationNumber: quoNumber,
        dealId: deal.id,
        validUntil: quoValidUntil || undefined,
        notes: quoNotes,
        lineItems: [],
      });
      setQuoDialogOpen(false);
      setQuoNumber("");
      setQuoValidUntil("");
      setQuoNotes("");
      refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create quotation");
    } finally {
      setQuoSubmitting(false);
    }
  };

  const handleDownloadQuotationPdf = async (id: string) => {
    try {
      const res = await quotationApi.pdf(id);
      if (!res.ok) throw new Error("Failed to download");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quotation-${id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to download PDF");
    }
  };

  const handleDeleteQuotation = async (id: string) => {
    if (!window.confirm("Delete this quotation?")) return;
    try {
      await quotationApi.remove(id);
      refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete quotation");
    }
  };

  // Sales Order dialog state
  const [soDialogOpen, setSoDialogOpen] = useState(false);
  const [soNumber, setSoNumber] = useState("");
  const [soOrderDate, setSoOrderDate] = useState("");
  const [soShippingAddress, setSoShippingAddress] = useState("");
  const [soNotes, setSoNotes] = useState("");
  const [soSubmitting, setSoSubmitting] = useState(false);

  const handleCreateSalesOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setSoSubmitting(true);
    try {
      await salesOrderApi.create({
        orderNumber: soNumber,
        dealId: deal.id,
        orderDate: soOrderDate || undefined,
        shippingAddress: soShippingAddress,
        notes: soNotes,
        lineItems: [],
      });
      setSoDialogOpen(false);
      setSoNumber("");
      setSoOrderDate("");
      setSoShippingAddress("");
      setSoNotes("");
      refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create sales order");
    } finally {
      setSoSubmitting(false);
    }
  };

  const handleDeleteSalesOrder = async (id: string) => {
    if (!window.confirm("Delete this sales order?")) return;
    try {
      await salesOrderApi.remove(id);
      refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete sales order");
    }
  };

  // Deal actions
  const handleMarkWon = async () => {
    if (!wonStage) return;
    try {
      await dealApi.move(deal.id, { stageId: wonStage.id });
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to mark won");
    }
  };

  const handleMarkLost = async () => {
    if (!lostStage) return;
    try {
      await dealApi.move(deal.id, { stageId: lostStage.id });
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to mark lost");
    }
  };

  const handleDeleteDeal = async () => {
    if (!window.confirm("Delete this deal?")) return;
    try {
      await dealApi.remove(deal.id);
      router.push("/(app)/deals");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete deal");
    }
  };

  const lineItemsTotal = deal.lineItems?.reduce((sum, item) => sum + item.total, 0) ?? 0;

  return (
    <div className="space-y-6" key={refreshKey}>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b pb-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{deal.name}</h1>
            <Badge variant={statusBadge(deal.stage?.type ?? "")}>
              {deal.stage?.name ?? "—"} ({deal.stage?.probability ?? 0}%)
            </Badge>
            <Badge variant={statusBadge(deal.status)}>
              {deal.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Pipeline: {deal.pipeline?.name ?? "—"}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <span className="text-3xl font-bold">
            {formatCompactCurrency(deal.value, deal.currency)}
          </span>
          {deal.expectedCloseDate && (
            <p className="text-sm text-muted-foreground">
              Expected close: {formatDate(deal.expectedCloseDate)}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Owner</CardTitle></CardHeader>
          <CardContent><p className="text-sm font-medium">{deal.owner?.name ?? "Unassigned"}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Contact</CardTitle></CardHeader>
          <CardContent><p className="text-sm font-medium">{deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : "Unassigned"}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Company</CardTitle></CardHeader>
          <CardContent><p className="text-sm font-medium">{deal.company?.name ?? "Unassigned"}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Probability</CardTitle></CardHeader>
          <CardContent><p className="text-sm font-medium">{deal.probability}%</p></CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        {isOpen && wonStage && <Button onClick={handleMarkWon} variant="success">Mark Won</Button>}
        {isOpen && lostStage && <Button onClick={handleMarkLost} variant="destructive">Mark Lost</Button>}
        <Button onClick={handleDeleteDeal} variant="destructive" size="sm">Delete</Button>
      </div>

      {/* Line Items */}
      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
          <CardDescription>{deal.lineItems?.length ?? 0} item{deal.lineItems?.length !== 1 ? "s" : ""}</CardDescription>
        </CardHeader>
        <CardContent>
          {deal.lineItems?.length ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Description</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit Price</th>
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deal.lineItems?.map((item) => (
                      <tr key={item.id} className="border-b">
                        <td className="px-3 py-2 font-medium">{item.name}</td>
                        <td className="px-3 py-2 text-sm text-muted-foreground max-w-xs truncate">{item.description || "—"}</td>
                        <td className="px-3 py-2 text-right">{item.quantity.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{formatCompactCurrency(item.unitPrice, item.product?.currency || deal.currency)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCompactCurrency(item.total, item.product?.currency || deal.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t font-semibold">
                      <td colSpan={4} className="px-3 py-3 text-right">Total</td>
                      <td className="px-3 py-3 text-right">{formatCompactCurrency(lineItemsTotal, deal.currency)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {lineItemsTotal !== deal.value && (
                <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                  Note: Line items total ({formatCompactCurrency(lineItemsTotal, deal.currency)}) differs from deal value ({formatCompactCurrency(deal.value, deal.currency)}).
                </p>
              )}
            </>
          ) : (
            <p className="text-center py-8 text-sm text-muted-foreground">No line items added yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Quotations */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle>Quotations</CardTitle>
            <CardDescription>{quotations.length} quotation{quotations.length !== 1 ? "s" : ""}</CardDescription>
          </div>
          <Button variant="outline" onClick={() => setQuoDialogOpen(true)}><Plus className="h-4 w-4 mr-2" /> Create Quotation</Button>
        </CardHeader>
        <CardContent>
          {loadingQuotations ? (
            <p className="text-sm text-muted-foreground">Loading quotations...</p>
          ) : quotations.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No quotations yet.</p>
          ) : (
            <div className="space-y-2">
              {quotations.map((q) => (
                <div key={q.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 border rounded">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
                    <span className="font-medium">{q.quotationNumber}</span>
                    <Badge variant={statusBadge(q.status)}>{q.status}</Badge>
                    <span className="text-sm text-muted-foreground">Total: {formatCompactCurrency(q.total)}</span>
                    {q.validUntil && <span className="text-sm text-muted-foreground">Valid until: {formatDate(q.validUntil)}</span>}
                    <span className="text-sm text-muted-foreground">{formatDateTime(q.createdAt)}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => handleDownloadQuotationPdf(q.id)} title="Download PDF"><FileText className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteQuotation(q.id)} title="Delete" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create Quotation Dialog */}
          <Dialog open={quoDialogOpen} onOpenChange={setQuoDialogOpen}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Quotation</DialogTitle>
                <DialogDescription>Enter quotation details. Line items can be added after creation.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateQuotation} className="grid gap-3 pt-6">
                <div className="flex flex-col gap-1.5">
                  <Label>Quotation Number <span className="text-destructive ml-0.5">*</span></Label>
                  <Input value={quoNumber} onChange={(e) => setQuoNumber(e.target.value)} placeholder="e.g. QUO-001" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Valid Until</Label>
                  <Input type="date" value={quoValidUntil} onChange={(e) => setQuoValidUntil(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Notes</Label>
                  <Textarea value={quoNotes} onChange={(e) => setQuoNotes(e.target.value)} placeholder="Optional notes" className="resize-none h-20" />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setQuoDialogOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={quoSubmitting || !quoNumber.trim()}>{quoSubmitting ? "Creating..." : "Create Quotation"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {/* Sales Orders */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle>Sales Orders</CardTitle>
            <CardDescription>{salesOrders.length} order{salesOrders.length !== 1 ? "s" : ""}</CardDescription>
          </div>
          <Button variant="outline" onClick={() => setSoDialogOpen(true)}><Plus className="h-4 w-4 mr-2" /> Create Sales Order</Button>
        </CardHeader>
        <CardContent>
          {loadingSalesOrders ? (
            <p className="text-sm text-muted-foreground">Loading sales orders...</p>
          ) : salesOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No sales orders yet.</p>
          ) : (
            <div className="space-y-2">
              {salesOrders.map((so) => (
                <div key={so.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 border rounded">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
                    <span className="font-medium">{so.orderNumber}</span>
                    <Badge variant={statusBadge(so.status)}>{so.status}</Badge>
                    <span className="text-sm text-muted-foreground">Total: {formatCompactCurrency(so.total)}</span>
                    <span className="text-sm text-muted-foreground">Order date: {formatDate(so.orderDate)}</span>
                    <span className="text-sm text-muted-foreground">{formatDateTime(so.createdAt)}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteSalesOrder(so.id)} title="Delete" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create Sales Order Dialog */}
          <Dialog open={soDialogOpen} onOpenChange={setSoDialogOpen}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Sales Order</DialogTitle>
                <DialogDescription>Enter sales order details. Line items can be added after creation.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateSalesOrder} className="grid gap-3 pt-6">
                <div className="flex flex-col gap-1.5">
                  <Label>Order Number <span className="text-destructive ml-0.5">*</span></Label>
                  <Input value={soNumber} onChange={(e) => setSoNumber(e.target.value)} placeholder="e.g. SO-001" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Order Date</Label>
                  <Input type="date" value={soOrderDate} onChange={(e) => setSoOrderDate(e.target.value)} defaultValue={new Date().toISOString().split("T")[0]} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Shipping Address</Label>
                  <Textarea value={soShippingAddress} onChange={(e) => setSoShippingAddress(e.target.value)} placeholder="Optional shipping address" className="resize-none h-20" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Notes</Label>
                  <Textarea value={soNotes} onChange={(e) => setSoNotes(e.target.value)} placeholder="Optional notes" className="resize-none h-20" />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setSoDialogOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={soSubmitting || !soNumber.trim()}>{soSubmitting ? "Creating..." : "Create Sales Order"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
