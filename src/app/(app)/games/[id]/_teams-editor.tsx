"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Card, CardContent } from "@/components/ui/card";
import { PlayerPill } from "@/components/player-pill";
import { cn } from "@/lib/utils";
import { moveTeamPlayerAction } from "./team-actions";

type Player = { userId: string; name: string | null; image: string | null };
export type EditableTeam = {
  id: string;
  label: "A" | "B" | "C";
  players: Player[];
};

/** A stable signature of who's in which team — used to resync after refresh. */
function membershipSig(teams: EditableTeam[]): string {
  return teams
    .map((t) => `${t.id}:${t.players.map((p) => p.userId).join(",")}`)
    .join("|");
}

export function TeamsEditor({
  gameId,
  teams: teamsProp,
  editable,
}: {
  gameId: string;
  teams: EditableTeam[];
  editable: boolean;
}) {
  const router = useRouter();
  const [teams, setTeams] = useState(teamsProp);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Re-sync to the server's view whenever membership actually changes (our own
  // saved move, or someone else's that arrived via a route refresh). Adjusting
  // state during render on a prop change is the React-recommended pattern.
  const sig = membershipSig(teamsProp);
  const [syncedSig, setSyncedSig] = useState(sig);
  if (sig !== syncedSig) {
    setSyncedSig(sig);
    setTeams(teamsProp);
  }

  // Separate mouse and touch handling: a short press-and-hold starts a drag on
  // touch (so the page can still scroll), a small drag threshold on mouse.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
  );

  const allPlayers = teams.flatMap((t) => t.players);
  const activePlayer = activeId
    ? (allPlayers.find((p) => p.userId === activeId) ?? null)
    : null;

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const userId = String(active.id);
    const fromTeamId = active.data.current?.fromTeamId as string | undefined;
    const toTeamId = String(over.id);
    if (!fromTeamId || fromTeamId === toTeamId) return;

    const player = allPlayers.find((p) => p.userId === userId);
    if (!player) return;

    const previous = teams;
    // Optimistically move, then persist; revert if the server rejects.
    setTeams((ts) =>
      ts.map((t) => {
        if (t.id === fromTeamId) {
          return { ...t, players: t.players.filter((p) => p.userId !== userId) };
        }
        if (t.id === toTeamId) {
          return { ...t, players: [...t.players, player] };
        }
        return t;
      }),
    );

    moveTeamPlayerAction({ gameId, userId, toTeamId })
      .then((r) => {
        if ("error" in r) {
          toast.error(r.error);
          setTeams(previous);
        } else {
          router.refresh();
        }
      })
      .catch(() => {
        toast.error("Couldn't move player — try again");
        setTeams(previous);
      });
  }

  const note = teams.length === 3 && (
    <p className="text-xs text-muted-foreground">
      Team C rotates in against the losing team and can borrow players if short.
    </p>
  );

  if (!editable) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Teams</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <Card key={team.id}>
              <CardContent className="space-y-2 p-4">
                <div className="font-semibold">Team {team.label}</div>
                {team.players.map((p) => (
                  <PlayerPill key={p.userId} name={p.name} image={p.image} />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
        {note}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Teams</h2>
        <span className="text-xs text-muted-foreground">
          Drag players between teams
        </span>
      </header>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <DroppableTeam key={team.id} team={team}>
              {team.players.map((p) => (
                <DraggablePlayer key={p.userId} player={p} teamId={team.id} />
              ))}
            </DroppableTeam>
          ))}
        </div>
        <DragOverlay>
          {activePlayer ? (
            <PlayerPill name={activePlayer.name} image={activePlayer.image} />
          ) : null}
        </DragOverlay>
      </DndContext>
      {note}
    </section>
  );
}

function DroppableTeam({
  team,
  children,
}: {
  team: EditableTeam;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: team.id });
  return (
    <Card
      ref={setNodeRef}
      className={cn(
        "transition-colors",
        isOver && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      <CardContent className="space-y-2 p-4">
        <div className="font-semibold">
          Team {team.label}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {team.players.length}
          </span>
        </div>
        {children}
        {team.players.length === 0 && (
          <p className="rounded-lg border border-dashed py-3 text-center text-xs text-muted-foreground">
            Drop players here
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DraggablePlayer({
  player,
  teamId,
}: {
  player: Player;
  teamId: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: player.userId,
    data: { fromTeamId: teamId },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // touch-none lets dnd-kit handle the gesture instead of the browser
      // scrolling/selecting while dragging a pill.
      className={cn(
        "touch-none cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      <PlayerPill name={player.name} image={player.image} />
    </div>
  );
}
