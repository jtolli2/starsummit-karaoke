FROM alpine:3.22

# Keep the runtime pinned; upgrade this value only with a reviewed migration/test update.
ARG PB_VERSION=0.39.7
RUN apk add --no-cache ca-certificates curl \
  && curl -fsSL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" -o /tmp/pocketbase.zip \
  && apk add --no-cache unzip \
  && unzip /tmp/pocketbase.zip pocketbase -d /usr/local/bin \
  && chmod +x /usr/local/bin/pocketbase \
  && rm -f /tmp/pocketbase.zip \
  && apk del unzip

WORKDIR /pb
COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks
COPY README.md /pb/README.md
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
VOLUME ["/pb/pb_data"]
EXPOSE 8090
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
