"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Mail, Package, Phone, Plus, Trash2, Users, X } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, dealApi, dealLineItemApi, productApi, priceListApi, ApiError } from "@/lib/api-client";
import { formatCompactCurrency, formatDate, formatDateTime, timeAgo } from "@/lib/format";
import type { ActivityItem, Deal, DealLineItem, EmailItem, PriceList, Product, TaskItem } from "@/lib/api-client";

type DealDetailProps = {
  deal: Deal;
  activities: ActivityItem[];
  emails: EmailItem[];
  tasks: TaskItem[];
  onMarkWon: () => void;
  onMarkLost: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddNote: (body: string) => void;
};

const STAGE_VARIANT: Record<string, "default" | "success" | "destructive" | "outline" | "secondary"> = {
  WON: "success",
  LOST: "destructive",
} as const;

function stageVariant(type: string) {
  return STAGE_VARIANT[type] ?? "default";
}

function LineItemRow({
  item,
  products,
  priceLists,
  onUpdate,
  onRemove,
  readOnly,
}: {
  item: DealLineItem;
  products: Product[];
  priceLists: PriceList[];
  onUpdate: (id: string, data: Partial<DealLineItem>) => void;
  onRemove: (id: string) => void;
  readOnly: boolean;
}) {
  const product = item.productId ? products.find((p) => p.id === item.productId) : null;

  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({
    name: item.name,
    description: item.description,
    quantity: String(item.quantity),
    unitPrice: String(item.unitPrice),
    total: String(item.total),
  });

  const handleSave = () => {
    const quantity = Number(values.quantity);
    const unitPrice = Number(values.unitPrice);
    const total = Number(values.total);
    
    if (Math.abs(total - quantity * unitPrice) > 0.01) {
      alert("Total must equal quantity x unit price");
      return;
    }
    
    onUpdate(item.id, {
      name: values.name,
      description: values.description,
      quantity,
      unitPrice,
      total,
    });
    setEditing(false);
  };

  return (
    <tr className="border-b">
      <td className="px-3 py-2">
        {editing ? (
          <Input
            value={values.name}
            onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full"
          />
        ) : (
          <span className="font-medium">{item.name}</span>
        )}
      </td>
      <td className="px-3 py-2 text-sm text-muted-foreground max-w-xs truncate">
        {editing ? (
          <Input
            value={values.description}
            onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
            className="w-full"
          />
        ) : (
          item.description || "—"
        )}
      </td>
      <td className="px-3 py-2">
        {editing ? (
          <Input
            type="number"
            step="0.01"
            min="0.01"
            value={values.quantity}
            onChange={(e) => {
              const q = e.target.value;
              setValues((v) => ({ ...v, quantity: q }));
              if (values.unitPrice) {
                setValues((v) => ({ ...v, total: String(Number(q) * Number(values.unitPrice)) }));
              }
            }}
            className="w-20"
          />
        ) : (
          item.quantity.toLocaleString()
        )}
      </td>
      <td className="px-3 py-2">
        {editing ? (
          <Input
            type="number"
            step="0.01"
            min="0"
            value={values.unitPrice}
            onChange={(e) => {
              const up = e.target.value;
              setValues((v) => ({ ...v, unitPrice: up }));
              if (values.quantity) {
                setValues((v) => ({ ...v, total: String(Number(values.quantity) * Number(up)) }));
              }
            }}
            className="w-24"
          />
        ) : (
          formatCompactCurrency(item.unitPrice, item.product?.currency || "USD")
        )}
      </td>
      <td className="px-3 py-2 font-medium">
        {editing ? (
          <Input
            type="number"
            step="0.01"
            min="0"
            value={values.total}
            onChange={(e) => setValues((v) => ({ ...v, total: e.target.value }))}
            className="w-28"
          />
        ) : (
          formatCompactCurrency(item.total, item.product?.currency || "USD")
        )}
      </td>
      <td className="px-3 py-2">
        {!readOnly && (
          <div className="flex items-center gap-1">
            {editing ? (
              <>
                <Button variant="outline" size="icon" onClick={handleSave} title="Save">
                  <CheckCircle2 className="h-3 w-3" />
                </Button>
                <Button variant="outline" size="icon" onClick={() => setEditing(false)} title="Cancel">
                  <X className="h-3 w-3" />
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="icon" onClick={() => setEditing(true)} title="Edit">
                  <Package className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => onRemove(item.id)} title="Remove">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function AddLineItemForm({
  dealId,
  products,
  priceLists,
  onAdd,
}: {
  dealId: string;
  products: Product[];
  priceLists: PriceList[];
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [total, setTotal] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedProduct = products.find((p) => p.id === productId);
  const priceListItem = selectedProduct
    ? priceLists.flatMap((pl) => pl.items || []).find((pi) => pi.productId === selectedProduct.id)
    : null;

  const handleProductChange = (id: string) => {
    setProductId(id);
    const product = products.find((p) => p.id === id);
    if (product) {
      setName(product.name);
      setDescription(product.description);
      if (!unitPrice || productId === "") {
        setUnitPrice(String(product.unitPrice));
      }
    }
    const plItem = priceLists.flatMap((pl) => pl.items || []).find((pi) => pi.productId === id);
    if (plItem && !unitPrice) {
      setUnitPrice(String(plItem.price));
    }
    if (quantity && unitPrice) {
      setTotal(String(Number(quantity) * Number(unitPrice)));
    }
  };

  const handleQuantityChange = (val: string) => {
    setQuantity(val);
    if (val && unitPrice) {
      setTotal(String(Number(val) * Number(unitPrice)));
    }
  };

  const handleUnitPriceChange = (val: string) => {
    setUnitPrice(val);
    if (quantity && val) {
      setTotal(String(Number(quantity) * Number(val)));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert("Name is required");
      return;
    }
    const q = Number(quantity);
    const up = Number(unitPrice);
    const t = Number(total);
    if (Math.abs(t - q * up) > 0.01) {
      alert("Total must equal quantity x unit price");
      return;
    }
    setSubmitting(true);
    try {
      await dealLineItemApi.create(dealId, {
        productId: productId || undefined,
        name: name.trim(),
        description: description.trim(),
        quantity: q,
        unitPrice: up,
        total: t,
      });
      setOpen(false);
      setProductId("");
      setName("");
      setDescription("");
      setQuantity("1");
      setUnitPrice("");
      setTotal("");
      onAdd();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Failed to add line item");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="w-full">
        <Plus className="h-4 w-4 mr-2" /> Add line item
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add line item</DialogTitle>
            <DialogDescription>
              Select a product or enter a custom line item. Price lists will auto-fill pricing.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="grid gap-3 pt-6">
            <div className="flex flex-col gap-1.5">
              <Label>Product (optional)</Label>
              <Select value={productId} onValueChange={handleProductChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a product or leave blank for custom item..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Custom item</SelectItem>
                  {products
                    .filter((p) => p.isActive)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} {p.sku ? `(${p.sku})` : ""} — {formatCompactCurrency(p.unitPrice, p.currency)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Name <span className="text-destructive ml-0.5">*</span></Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Enterprise License"
                disabled={!!productId}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                disabled={!!productId}
                className="resize-none h-20"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label>Quantity <span className="text-destructive ml-0.5">*</span></Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={quantity}
                  onChange={(e) => handleQuantityChange(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Unit price <span className="text-destructive ml-0.5">*</span></Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={unitPrice}
                  onChange={(e) => handleUnitPriceChange(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Total <span className="text-destructive ml-0.5">*</span></Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={total}
                  onChange={(e) => setTotal(e.target.value)}
                  readOnly
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !name.trim()}>
                {submitting ? "Adding..." : "Add line item"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DealDetail({
  deal,
  activities,
  emails,
  tasks,
  onMarkWon,
  onMarkLost,
  onEdit,
  onDelete,
  onAddNote,
}: DealDetailProps) {
  const isOpen = deal.status === "OPEN";
  const [noteBody, setNoteBody] = useState("");
  const [noteError, setNoteError] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [lineItems, setLineItems] = useState<DealLineItem[]>(deal.lineItems || []);
  const [refreshKey, setRefreshKey] = useState(0);

  const notes = activities.filter((a) => a.type === "NOTE");
  const otherActivities = activities.filter((a) => a.type !== "NOTE");
  const history = [...deal.stageHistory].sort((a, b) => a.at.localeCompare(b.at));

  useEffect(() => {
    let cancelled = false;
    setLoadingProducts(true);
    Promise.all([
      productApi.list({ isActive: true, pageSize: 200 }),
      priceListApi.list({ pageSize: 20 }),
    ]).then(([prodRes, plRes]) => {
      if (!cancelled) {
        setProducts(prodRes.products);
        setPriceLists(plRes.priceLists);
        setLoadingProducts(false);
      }
    }).catch(() => {
      if (!cancelled) setLoadingProducts(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshLineItems = useCallback(async () => {
    try {
      const res = await dealLineItemApi.list(deal.id);
      setLineItems(res.lineItems);
    } catch (e) {
      console.error("Failed to refresh line items:", e);
    }
  }, [deal.id]);

  async function addNote() {
    if (!noteBody.trim()) {
      setNoteError("Note cannot be empty");
      return;
    }
    setAddingNote(true);
    setNoteError("");
    try {
      await onAddNote(noteBody.trim());
      setNoteBody("");
    } catch (e) {
      setNoteError(e instanceof ApiError ? e.message : "Failed to save note");
    } finally {
      setAddingNote(false);
    }
  }

  const handleLineItemAdd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    refreshLineItems();
  }, [refreshLineItems]);

  const handleLineItemUpdate = useCallback(async (id: string, data: Partial<DealLineItem>) => {
    try {
      await dealLineItemApi.update(deal.id, id, data);
      refreshLineItems();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Failed to update line item");
    }
  }, [deal.id, refreshLineItems]);

  const handleLineItemRemove = useCallback(async (id: string) => {
    if (!window.confirm("Remove this line item?")) return;
    try {
      await dealLineItemApi.remove(deal.id, id);
      refreshLineItems();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Failed to remove line item");
    }
  }, [deal.id, refreshLineItems]);

  const wonStage = deal.pipeline.stages.find((s) => s.type === "WON");
  const lostStage = deal.pipeline.stages.find((s) => s.type === "LOST");

  const lineItemsTotal = lineItems.reduce((sum, item) => sum + item.total, 0);

  return (
    <div className="space-y-6" key={refreshKey}>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b pb-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{deal.name}</h1>
            <Badge variant={stageVariant(deal.stage.type)}>
              {deal.stage.name} ({deal.stage.probability}%)
            </Badge>
            <Badge variant={deal.status === "WON" ? "success" : deal.status === "LOST" ? "destructive" : "default"}>
              {deal.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Pipeline: {deal.pipeline.name}
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
          <CardHeader>
            <CardTitle className="text-sm">Owner</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">{deal.owner?.name ?? "Unassigned"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">{deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : "Unassigned"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Company</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">{deal.company?.name ?? "Unassigned"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Probability</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">{deal.probability}%</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium">{deal.status}</p>
            {deal.wonAt && <p className="text-xs text-muted-foreground">Won: {formatDateTime(deal.wonAt)}</p>}
            {deal.lostAt && <p className="text-xs text-muted-foreground">Lost: {formatDateTime(deal.lostAt)}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Next step</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{deal.nextStep || "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Lost reason</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{deal.lostReason || "—"}</p>
          </CardContent>
        </Card>
        <Card className="md:col-span-4">
          <CardHeader>
            <CardTitle className="text-sm">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{deal.summary || "No summary recorded."}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        {isOpen && wonStage && (
          <Button onClick={onMarkWon} variant="success">
            Mark Won
          </Button>
        )}
        {isOpen && lostStage && (
          <Button onClick={onMarkLost} variant="destructive">
            Mark Lost
          </Button>
        )}
        <Button onClick={onEdit}>Edit</Button>
        <Button onClick={onDelete} variant="destructive" size="sm">
          Delete
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle>Line Items</CardTitle>
            <CardDescription>{lineItems.length} item{lineItems.length !== 1 ? "s" : ""}</CardDescription>
          </div>
          {isOpen && (
            <AddLineItemForm
              dealId={deal.id}
              products={products}
              priceLists={priceLists}
              onAdd={handleLineItemAdd}
            />
          )}
        </CardHeader>
        <CardContent>
          {lineItems.length === 0 ? (
            <div className="text-center py-8">
              <Package className="h-12 w-12 mx-auto text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">No line items added yet.</p>
              {isOpen && (
                <Button variant="outline" className="mt-4" onClick={() => setRefreshKey((k) => k + 1)}>
                  <Plus className="h-4 w-4 mr-2" /> Add first line item
                </Button>
              )}
            </div>
          ) : (
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
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item) => (
                      <LineItemRow
                        key={item.id}
                        item={item}
                        products={products}
                        priceLists={priceLists}
                        onUpdate={handleLineItemUpdate}
                        onRemove={handleLineItemRemove}
                        readOnly={!isOpen}
                      />
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t font-semibold">
                      <td colSpan={4} className="px-3 py-3 text-right">Total</td>
                      <td className="px-3 py-3 text-right">
                        {formatCompactCurrency(lineItemsTotal, deal.currency)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {lineItemsTotal !== deal.value && (
                <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                  Note: Line items total ({formatCompactCurrency(lineItemsTotal, deal.currency)}) differs from deal value ({formatCompactCurrency(deal.value, deal.currency)}).
                  The deal value will be updated when line items are saved.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stage history</CardTitle>
          <CardDescription>{history.length} stage change{history.length !== 1 ? "s" : ""}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stage changes yet.</p>
          ) : (
            <>
              {history.map((h, i) => {
                const isFirst = i === 0;
                const won = h.toStage.type === "WON";
                const lost = h.toStage.type === "LOST";
                return (
                  <div key={h.id} className="flex gap-3">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs">
                      {h.user.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium leading-none">
                        {isFirst ? "Started in" : h.fromStage?.name ?? "Unknown stage"}{" "}
                        <span className="text-muted-foreground">→</span>{" "}
                        {h.toStage.name}
                      </p>
                      <p className="text-xs text-muted-foreground leading-none">
                        {h.user.name} · {formatDateTime(h.at)} ({timeAgo(h.at)})
                      </p>
                    </div>
                    {(won || lost) && (
                      <Badge variant={won ? "success" : "destructive"} className="shrink-0">
                        {won ? "Won" : "Lost"}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activities</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {otherActivities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity recorded.</p>
          ) : (
            <ol className="space-y-4">
              {otherActivities.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs">
                    {a.user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{a.title}</p>
                    {a.description && <p className="text-xs text-muted-foreground line-clamp-1">{a.description}</p>}
                    <p className="text-xs text-muted-foreground leading-none">
                      {a.user.name} · {formatDateTime(a.occurredAt)} ({timeAgo(a.occurredAt)})
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            <ol className="space-y-4">
              {notes.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs">
                    {a.user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm">{a.description}</p>
                    <p className="text-xs text-muted-foreground leading-none">
                      {a.user.name} · {formatDateTime(a.occurredAt)} ({timeAgo(a.occurredAt)})
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Label htmlFor="deal-note">Add note</Label>
            <div className="flex flex-col gap-1">
              <Textarea
                id="deal-note"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Write a note..."
                className="resize-none h-24"
              />
              {noteError && <p className="text-xs text-destructive" role="alert">{noteError}</p>}
            </div>
            <Button
              onClick={addNote}
              disabled={addingNote || !noteBody.trim()}
              className="md:col-span-2 lg:col-span-3 self-start"
            >
              {addingNote ? "Saving..." : "Save note"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Emails</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {emails.length === 0 ? (
            <p className="text-sm text-muted-foreground">No emails linked to this deal.</p>
          ) : (
            <ol className="space-y-3">
              {emails.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs shrink-0">
                    <Mail className="h-3 w-3" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{e.subject}</p>
                    <p className="text-xs text-muted-foreground leading-none">
                      {e.recipientName || e.recipientEmail} · {e.status} · {formatDateTime(e.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks linked to this deal.</p>
          ) : (
            <ol className="space-y-3">
              {tasks.map((t) => (
                <li key={t.id} className="flex gap-3">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs shrink-0">
                    <CheckCircle2 className="h-3 w-3" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground leading-none">
                      {t.type} · {t.status}{t.dueAt ? ` · ${formatDate(t.dueAt)}` : ""}{t.assignedUser ? ` · ${t.assignedUser.name}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
