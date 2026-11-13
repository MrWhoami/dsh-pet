using System.Text.Json;
using System.Text.Json.Serialization;

namespace DshPetOverlay;

/// <summary>The subset of /api/pet/state the overlay consumes.</summary>
internal sealed class PetStateDto
{
    [JsonPropertyName("animation")] public string? Animation { get; set; }
    [JsonPropertyName("bubble")] public string? Bubble { get; set; }
    [JsonPropertyName("statusBubbles")] public string? StatusBubbles { get; set; }
    [JsonPropertyName("phase")] public string? Phase { get; set; }
    [JsonPropertyName("display")] public PetDisplayDto? Display { get; set; }
    [JsonPropertyName("pet")] public PetIdentityDto? Pet { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    /// <summary>One bubble per active top-level session (the GUI's current one first).</summary>
    [JsonPropertyName("sessions")] public List<PetSessionDto>? Sessions { get; set; }
    [JsonPropertyName("affinity")] public PetAffinityDto? Affinity { get; set; }
    [JsonPropertyName("treats")] public PetTreatsDto? Treats { get; set; }
}

internal sealed class PetSessionDto
{
    [JsonPropertyName("sessionId")] public string? SessionId { get; set; }
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("bubble")] public string? Bubble { get; set; }
    [JsonPropertyName("whisper")] public string? Whisper { get; set; }
    [JsonPropertyName("phase")] public string? Phase { get; set; }
}

internal sealed class PetAffinityDto
{
    [JsonPropertyName("points")] public double Points { get; set; }
    [JsonPropertyName("rank")] public string? Rank { get; set; }
    [JsonPropertyName("rankEmoji")] public string? RankEmoji { get; set; }
    [JsonPropertyName("pets")] public double Pets { get; set; }
    [JsonPropertyName("feeds")] public double Feeds { get; set; }
    [JsonPropertyName("turns")] public double Turns { get; set; }
}

internal sealed class PetTreatsDto
{
    [JsonPropertyName("stocked")] public double Stocked { get; set; }
    [JsonPropertyName("max")] public double Max { get; set; }
}

internal sealed class PetDisplayDto
{
    [JsonPropertyName("visible")] public bool Visible { get; set; } = true;
    [JsonPropertyName("size")] public double Size { get; set; } = 160;
    [JsonPropertyName("right")] public double Right { get; set; } = 24;
    [JsonPropertyName("bottom")] public double Bottom { get; set; } = 20;
}

internal sealed class PetIdentityDto
{
    [JsonPropertyName("id")] public string? Id { get; set; }
    [JsonPropertyName("displayName")] public string? DisplayName { get; set; }
}

/// <summary>The subset of one /api/pet/pets registry entry the overlay consumes.</summary>
internal sealed class PetDefDto
{
    [JsonPropertyName("gameplay")] public JsonElement? Gameplay { get; set; }
    [JsonPropertyName("id")] public string? Id { get; set; }
    [JsonPropertyName("renderer")] public string? Renderer { get; set; }
    [JsonPropertyName("cell")] public PetCellDto? Cell { get; set; }
    [JsonPropertyName("atlasUrl")] public string? AtlasUrl { get; set; }
    [JsonPropertyName("tracks")] public Dictionary<string, PetTrackDto>? Tracks { get; set; }
}

internal sealed class PetCellDto
{
    [JsonPropertyName("width")] public double Width { get; set; }
    [JsonPropertyName("height")] public double Height { get; set; }
}

internal sealed class PetTrackDto
{
    /// <summary>Cell indices (sprite2d) or frame URLs (frames2d), read per renderer.</summary>
    [JsonPropertyName("frames")] public JsonElement Frames { get; set; }
    [JsonPropertyName("durations")] public double[]? Durations { get; set; }
    [JsonPropertyName("loop")] public bool Loop { get; set; }
    [JsonPropertyName("fallback")] public string? Fallback { get; set; }

    public int[] CellIndices()
    {
        if (Frames.ValueKind != JsonValueKind.Array) return Array.Empty<int>();
        var list = new List<int>(Frames.GetArrayLength());
        foreach (var frame in Frames.EnumerateArray())
        {
            if (frame.ValueKind == JsonValueKind.Number && frame.TryGetInt32(out var index)) list.Add(index);
        }
        return list.ToArray();
    }
}
