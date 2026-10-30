#!/bin/sh
# Sampler of measure-resources.yml: nothing installed, it only reads /proc,
# the cgroups v2 and `docker`. Two uses:
#   measure-resources.sh collect <interval_s> <file>   (transient service)
#   measure-resources.sh summary <file>                (final table)
# Lines of the file:
#   H <start date> <kernel> <cpu_count> <interval>
#   S <t> <MemTotal> <MemAvailable> <SwapTotal> <SwapFree> (KiB)
#     <cpu_total> <cpu_idle> (jiffies, /proc/stat)
#     <used_/> <size_/> <used_docker> <size_docker> (KiB, df)
#   C <t> <container> <memory.current> <memory.peak> (bytes) <usage_usec>
# <t> = /proc/uptime (hundredths of a second, insensitive to clock settings).
set -eu
export LC_ALL=C

collect() {
  interval=$1 file=$2 map="$2.map"
  : > "$map"
  echo "H $(date -Iseconds) $(uname -r) $(nproc) $interval" > "$file"
  while :; do
    t=$(cut -d' ' -f1 /proc/uptime)
    mem=$(awk '/^(MemTotal|MemAvailable|SwapTotal|SwapFree):/ {printf "%s ", $2}' /proc/meminfo)
    # Aggregated "cpu" line: user nice system idle iowait irq softirq steal.
    cpu=$(awk '$1 == "cpu" {print $2+$3+$4+$5+$6+$7+$8+$9, $5+$6; exit}' /proc/stat)
    root=$(df -k --output=used,size / | tail -n 1)
    docker=$(df -k --output=used,size /var/lib/docker 2>/dev/null | tail -n 1) || docker="0 0"
    echo "S $t $mem$cpu $root $docker" >> "$file"

    # Cgroup of each new container, resolved once through its main process
    # (/proc/<pid>/cgroup): works with runc as with runsc, whatever the cgroup
    # driver. Map: <id> <name> <dir>.
    for id in $(docker ps -q --no-trunc 2>/dev/null); do
      grep -q "^$id " "$map" && continue
      info=$(docker inspect -f '{{.Name}} {{.State.Pid}}' "$id" 2>/dev/null) || continue
      path=$(sed -n 's/^0:://p' "/proc/${info##* }/cgroup" 2>/dev/null) || continue
      [ -n "$path" ] && [ "$path" != / ] || continue
      name=${info%% *}
      echo "$id ${name#/} /sys/fs/cgroup$path" >> "$map"
    done
    while read -r _ name dir; do
      [ -f "$dir/memory.current" ] || continue
      current=$(cat "$dir/memory.current") || continue
      peak=$(cat "$dir/memory.peak" 2>/dev/null) || peak=0
      usec=$(awk '$1 == "usage_usec" {print $2}' "$dir/cpu.stat") || continue
      echo "C $t $name $current $peak $usec" >> "$file"
    done < "$map"
    sleep "$interval"
  done
}

summary() {
  awk '
    $1 == "H" { start = $2; kernel = $3; ncpu = $4; step = $5 }
    $1 == "S" {
      if (t0 == "") t0 = $2; t1 = $2; n++
      used = ($3 - $4) / 1024; msum += used; if (used > mmax) mmax = used
      if (avail == "" || $4 < avail) avail = $4
      swap = ($5 - $6) / 1024; if (swap > smax) smax = swap
      if (ptot != "" && $7 > ptot) {
        c = 100 * (1 - ($8 - pidle) / ($7 - ptot)); cn++; csum += c; if (c > cmax) cmax = c
      }
      ptot = $7; pidle = $8
      if ($9 > rmax) rmax = $9; rsize = $10
      if ($11 > dmax) dmax = $11; dsize = $12; rend = $9; dend = $11
    }
    $1 == "C" {
      k = $3; m = $4 / 1048576; if (m > cm[k]) cm[k] = m
      p = $5 / 1048576; if (p > cp[k]) cp[k] = p
      if ((k in ct) && $2 > ct[k]) {
        c = ($6 - cu[k]) / 1e4 / ($2 - ct[k]); ccn[k]++; ccs[k] += c; if (c > ccm[k]) ccm[k] = c
      }
      ct[k] = $2; cu[k] = $6
    }
    END {
      if (n == 0) { print "No sample."; exit 1 }
      printf "Start %s, duration %d min, %d samples (step %s s), kernel %s, %d CPU\n", start, (t1 - t0) / 60, n, step, kernel, ncpu
      printf "Memory used (MemTotal - MemAvailable): peak %d MiB, average %d MiB, of %d MiB\n", mmax, msum / n, ptot_mem
      printf "Lowest MemAvailable: %d MiB; highest swap used: %d MiB\n", avail / 1024, smax
      printf "Processor (all CPUs, %% of the machine): peak %.0f %%, average %.0f %%\n", cmax, cn ? csum / cn : 0
      printf "Disk /: peak %.1f GiB, end %.1f GiB, of %.1f GiB\n", rmax / 1048576, rend / 1048576, rsize / 1048576
      printf "Disk /var/lib/docker: peak %.1f GiB, end %.1f GiB, of %.1f GiB\n", dmax / 1048576, dend / 1048576, dsize / 1048576
      print "Containers (mem. MiB: sampled peak | memory.peak; CPU % of one core: peak | average):"
      sorter = "sort -t\"|\" -k3,3nr"
      for (k in cm)
        printf "  %-40s | %6d | %6d | %5.0f | %5.0f\n", k, cm[k], cp[k], ccm[k], ccn[k] ? ccs[k] / ccn[k] : 0 | sorter
      close(sorter)
    }
  ' ptot_mem="$(awk '$1 == "S" {print int($3 / 1024); exit}' "$1")" "$1"
}

"$@"
