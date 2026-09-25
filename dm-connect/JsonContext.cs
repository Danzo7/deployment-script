using System.Text.Json.Serialization;

namespace DmConnect;

internal record ServerConfig(string name, string host, int port);

internal record SavedServers(List<ServerConfig> servers, string? lastConnected);

[JsonSerializable(typeof(SavedServers))]
[JsonSerializable(typeof(ServerConfig))]
internal partial class AppJsonContext : JsonSerializerContext { }
