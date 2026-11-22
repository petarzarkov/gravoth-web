// Writes real saves with the game's own SaveCodec, so the rules checker reads saves the game itself could have written. Groups
// separated by "+": a file name, 1 to sign the heroes' board records (0 for none), then six arguments a hero: name class level
// chartTier pitFloor hardcore(0/1). With records, the save gets its id and witnessed bests the way the game makes them
// (BoardRules.Backfill, then TryRecord for each hero's floor and tier), signed with a test key the checker does not hold, so it
// reports them "unchecked". The end-to-end run posts records against save.txt and uploads the realm-*.txt files as online realms.
//   dotnet run -- <out dir> save.txt 0 Ashgrove barbarian 58 9 0 0 + realm.txt 1 Ember barbarian 60 0 60 1
using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Gravoth.Core.Characters;
using Gravoth.Core.Content;
using Gravoth.Core.Feats;

var outDir = args[0];
int at = 1;
while (at < args.Length)
{
    string file = args[at++];
    bool records = args[at++] == "1";
    var slots = new SaveSlots();
    var made = new System.Collections.Generic.List<(CharacterSave Hero, int Tier, int Pit)>();
    while (at < args.Length && args[at] != "+")
    {
        string name = args[at], cls = args[at + 1];
        int level = int.Parse(args[at + 2]), tier = int.Parse(args[at + 3]), pit = int.Parse(args[at + 4]);
        bool hardcore = args[at + 5] == "1";
        at += 6;
        var status = slots.TryCreate(name, Enum.Parse<ClassId>(cls, true), "male", "hair_01", StartingKits.Melee, hardcore, out var c);
        if (status != CreateStatus.Ok) throw new Exception($"create {name}: {status}");
        c.Level = level;
        c.Atlas.HighestTier = tier;
        if (pit > 0)
        {
            c.PitBestCleared = pit;
            c.PitUnlockedFloor = pit + 1;
        }
        made.Add((c, tier, pit));
        Console.Error.WriteLine($"hero {file} {c.Id} {c.Name} {c.Class} level {c.Level} tier {tier} pit {pit}{(hardcore ? " hardcore" : "")}");
    }
    if (at < args.Length) at++; // the "+"
    if (records)
    {
        var witness = new TestWitness();
        BoardRules.Backfill(slots, witness, 7, 11);
        foreach (var (c, tier, pit) in made)
        {
            if (pit > 0) BoardRules.TryRecord(slots, Boards.PitFloor, pit, c, witness);
            if (tier > 0) BoardRules.TryRecord(slots, Boards.ChartTier, tier, c, witness);
        }
        foreach (var r in slots.Bests.Records) Console.Error.WriteLine($"best {file} {r.Board} {r.Value} {r.CharacterId}");
    }
    File.WriteAllText(Path.Combine(outDir, file), SaveCodec.Encode(slots));
}

/// <summary>The game's witness with a test key (the release key never leaves its file outside the repo).</summary>
internal sealed class TestWitness : IBoardWitness
{
    private static readonly byte[] Key = Encoding.UTF8.GetBytes("gravoth e2e board key, never the release key");
    public bool CanSign => true;
    public string Sign(string message)
    {
        using var h = new HMACSHA256(Key);
        return Convert.ToHexString(h.ComputeHash(Encoding.UTF8.GetBytes(message))).ToLowerInvariant();
    }
}
