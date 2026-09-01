#!/bin/sh
# Docker 29 on this host does not install bridge firewall rules for user-defined
# networks, and does not remove them when a network is deleted. With ufw's
# DEFAULT_FORWARD_POLICY="DROP", the missing rules silently kill all container
# egress: TCP hangs until timeout while ICMP still passes, because ufw permits
# forwarded ICMP. This re-applies the two rules Docker should have written.
#
# Both are derived from the network name, so recreating caddy_net (new id, new
# bridge, possibly new subnet) needs no edit here.
set -eu

NET=caddy_net

# docker.service reports ready before its chains and networks are fully settled.
i=0
while [ "$i" -lt 30 ]; do
	if docker network inspect "$NET" >/dev/null 2>&1 \
		&& iptables -S DOCKER-FORWARD >/dev/null 2>&1; then
		break
	fi
	i=$((i + 1))
	sleep 1
done

ID=$(docker network inspect "$NET" --format '{{.Id}}' | cut -c1-12)
BR="br-$ID"
SUBNET=$(docker network inspect "$NET" --format '{{(index .IPAM.Config 0).Subnet}}')

# -C tests for an existing identical rule, so re-running never duplicates.
iptables -C DOCKER-FORWARD -i "$BR" -j ACCEPT 2>/dev/null \
	|| iptables -A DOCKER-FORWARD -i "$BR" -j ACCEPT

iptables -t nat -C POSTROUTING -s "$SUBNET" ! -o "$BR" -j MASQUERADE 2>/dev/null \
	|| iptables -t nat -A POSTROUTING -s "$SUBNET" ! -o "$BR" -j MASQUERADE

echo "ensured firewall rules for $NET (bridge $BR, subnet $SUBNET)"
