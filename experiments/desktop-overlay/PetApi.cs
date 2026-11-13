using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace DshPetOverlay;

/// <summary>Loopback JSON client for the dsh-pet host routes.</summary>
internal sealed class PetApi : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly HttpClient _http;
    private readonly string _baseUrl;

    public PetApi(string baseUrl)
    {
        _baseUrl = baseUrl.TrimEnd('/');
        _http = new HttpClient
        {
            BaseAddress = new Uri(_baseUrl + "/"),
            Timeout = TimeSpan.FromSeconds(6),
        };
    }

    public string BaseUrl => _baseUrl;

    public async Task<PetStateDto?> GetStateAsync(CancellationToken cancellationToken = default)
    {
        using var response = await _http.GetAsync("api/pet/state?desktop=1", cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) return null;
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        return await JsonSerializer.DeserializeAsync<PetStateDto>(stream, JsonOptions, cancellationToken).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<PetDefDto>> GetPetsAsync(CancellationToken cancellationToken = default)
    {
        using var response = await _http.GetAsync("api/pet/pets", cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) return Array.Empty<PetDefDto>();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        return await JsonSerializer.DeserializeAsync<List<PetDefDto>>(stream, JsonOptions, cancellationToken).ConfigureAwait(false)
            ?? new List<PetDefDto>();
    }

    public async Task<byte[]?> GetBytesAsync(string relativeUrl, CancellationToken cancellationToken = default)
    {
        var url = relativeUrl.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? relativeUrl
            : relativeUrl.TrimStart('/');
        using var response = await _http.GetAsync(url, cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) return null;
        return await response.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Tell the host the first frame is visible; null means a legacy host without the route.</summary>
    public async Task<bool?> MarkReadyAsync(CancellationToken cancellationToken = default)
    {
        using var body = new StringContent("{}", Encoding.UTF8, "application/json");
        using var response = await _http.PostAsync("api/pet/overlay/ready", body, cancellationToken).ConfigureAwait(false);
        if (response.StatusCode == HttpStatusCode.NotFound) return null;
        return response.IsSuccessStatusCode;
    }

    public async Task<string?> InteractAsync(string kind, CancellationToken cancellationToken = default)
    {
        var body = new StringContent(JsonSerializer.Serialize(new { kind }), Encoding.UTF8, "application/json");
        using var response = await _http.PostAsync("api/pet/interact", body, cancellationToken).ConfigureAwait(false);
        return response.IsSuccessStatusCode ? await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false) : null;
    }

    /// <summary>Rename the active pet; returns the stored name on success.</summary>
    public async Task<string?> SetNameAsync(string name, CancellationToken cancellationToken = default)
    {
        var body = new StringContent(JsonSerializer.Serialize(new { name }), Encoding.UTF8, "application/json");
        using var response = await _http.PostAsync("api/pet/set-name", body, cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) return null;
        var json = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            return root.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True
                && root.TryGetProperty("name", out var stored) && stored.ValueKind == JsonValueKind.String
                ? stored.GetString() : null;
        }
        catch
        {
            return null;
        }
    }

    public void Dispose() => _http.Dispose();
}
