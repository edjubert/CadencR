use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use reqwest::Url;

use crate::error::AppError;

/// Refuse a URL before it becomes a request.
///
/// The service is a local process and pull-request bodies are attacker-controlled,
/// so an unrestricted image fetch could probe the user's own network.
pub fn ensure_fetchable(url: &Url) -> Result<(), AppError> {
    if url.scheme() != "https" {
        return Err(AppError::BadRequest(
            "Only HTTPS images are loaded, so the request cannot be read in transit".into(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::BadRequest(
            "An image URL cannot carry credentials".into(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::BadRequest("Image URL is missing a host".into()))?;
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    let reachable = match bare.parse::<IpAddr>() {
        Ok(address) => is_public_ip(address),
        Err(_) => is_public_domain(bare),
    };
    if !reachable {
        return Err(AppError::BadRequest(format!(
            "Images are only loaded from public hosts, and {host} is not one"
        )));
    }
    Ok(())
}

/// Validate a DNS result before it is pinned into the image-only HTTP client.
pub fn ensure_public_ip(address: IpAddr, host: &str) -> Result<(), AppError> {
    if is_public_ip(address) {
        return Ok(());
    }
    Err(AppError::BadRequest(format!(
        "Images are only loaded from public hosts, and {host} resolves to a private address"
    )))
}

fn is_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => is_public_v4(address),
        IpAddr::V6(address) => is_public_v6(address),
    }
}

fn is_public_v4(address: Ipv4Addr) -> bool {
    ![
        ("0.0.0.0", 8),
        ("10.0.0.0", 8),
        ("100.64.0.0", 10),
        ("127.0.0.0", 8),
        ("169.254.0.0", 16),
        ("172.16.0.0", 12),
        ("192.0.0.0", 24),
        ("192.0.2.0", 24),
        ("192.88.99.0", 24),
        ("192.168.0.0", 16),
        ("198.18.0.0", 15),
        ("198.51.100.0", 24),
        ("203.0.113.0", 24),
        ("224.0.0.0", 4),
        ("240.0.0.0", 4),
    ]
    .into_iter()
    .any(|(network, prefix)| {
        ipv4_in_prefix(
            address,
            network.parse().expect("static IPv4 network"),
            prefix,
        )
    })
}

fn ipv4_in_prefix(address: Ipv4Addr, network: Ipv4Addr, prefix: u32) -> bool {
    let mask = u32::MAX.checked_shl(32 - prefix).unwrap_or(0);
    u32::from(address) & mask == u32::from(network) & mask
}

fn is_public_v6(address: Ipv6Addr) -> bool {
    // Public IPv6 unicast is allocated from 2000::/3. Exclude the special-use
    // sub-ranges inside it as well; everything outside it is local, mapped,
    // multicast, documentation, or reserved.
    ipv6_in_prefix(address, "2000::".parse().unwrap(), 3)
        && ![
            ("2001::", 23),
            ("2001:db8::", 32),
            ("2002::", 16),
            ("3fff::", 20),
        ]
        .into_iter()
        .any(|(network, prefix)| {
            ipv6_in_prefix(
                address,
                network.parse().expect("static IPv6 network"),
                prefix,
            )
        })
}

fn ipv6_in_prefix(address: Ipv6Addr, network: Ipv6Addr, prefix: u32) -> bool {
    let mask = u128::MAX.checked_shl(128 - prefix).unwrap_or(0);
    u128::from(address) & mask == u128::from(network) & mask
}

fn is_public_domain(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host.contains('.')
        && !["localhost", "local", "internal", "home", "lan", "intranet"]
            .iter()
            .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_public_https_hosts_are_fetched() {
        for allowed in [
            "https://github.com/a.png",
            "https://8.8.8.8/a.png",
            "https://[2606:4700::1]/a.png",
        ] {
            ensure_fetchable(&Url::parse(allowed).unwrap()).expect(allowed);
        }
        for refused in [
            "http://github.com/a.png",
            "https://user:pass@github.com/a.png",
            "https://127.0.0.1/a.png",
            "https://10.0.0.5/a.png",
            "https://192.168.1.20/a.png",
            "https://169.254.169.254/latest/meta-data",
            "https://[::1]/a.png",
            "https://[fd00::1]/a.png",
            "https://localhost/a.png",
            "https://printer.local/a.png",
            "https://intranet/a.png",
        ] {
            assert!(
                ensure_fetchable(&Url::parse(refused).unwrap()).is_err(),
                "{refused}"
            );
        }
    }

    #[test]
    fn resolved_private_addresses_are_rejected() {
        for address in [
            "127.0.0.1",
            "10.0.0.1",
            "100.64.0.1",
            "169.254.169.254",
            "0.0.0.1",
            "198.18.0.1",
            "240.0.0.1",
            "::1",
            "fc00::1",
            "fec0::1",
            "fe80::1",
            "2001:db8::1",
            "::ffff:192.168.1.1",
        ] {
            let address = address.parse().expect("test IP");
            assert!(
                ensure_public_ip(address, "images.example.com").is_err(),
                "{address}"
            );
        }
        assert!(ensure_public_ip("1.1.1.1".parse().unwrap(), "images.example.com").is_ok());
        assert!(ensure_public_ip(
            "2606:4700:4700::1111".parse().unwrap(),
            "images.example.com"
        )
        .is_ok());
    }
}
