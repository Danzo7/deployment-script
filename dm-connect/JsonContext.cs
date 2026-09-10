using System.Text.Json.Serialization;

namespace DmConnect;

internal record LastConfig(string host, int port);

[JsonSerializable(typeof(LastConfig))]
internal partial class AppJsonContext : JsonSerializerContext { }
