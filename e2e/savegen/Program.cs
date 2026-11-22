// Writes a real save with the game's own SaveCodec, four arguments a hero: name class level chartTier. The end-to-end run
// posts records against it, so the rules checker reads a save the game itself could have written.
using System;
using System.IO;
using Gravoth.Core.Characters;
using Gravoth.Core.Content;

var slots = new SaveSlots();
for (int i = 1; i + 3 < args.Length + 1; i += 4)
{
    var cls = Enum.Parse<ClassId>(args[i], true);
    var status = slots.TryCreate(args[i - 1], cls, "male", "hair_01", StartingKits.Melee, out var c);
    if (status != CreateStatus.Ok) throw new Exception($"create {args[i - 1]}: {status}");
    c.Level = int.Parse(args[i + 1]);
    c.Atlas.HighestTier = int.Parse(args[i + 2]);
    Console.Error.WriteLine($"hero {c.Id} {c.Name} {c.Class} level {c.Level} tier {c.Atlas.HighestTier}");
}
Console.Out.Write(SaveCodec.Encode(slots));
