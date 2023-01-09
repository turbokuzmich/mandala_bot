Telegram.WebApp.ready();
Telegram.WebApp.expand();

moment.locale("ru");

const mapContainer = document.querySelector(".js-map");
const userInfo = document.querySelector(".js-user-info");
const actionsPane = document.querySelector(".js-pane-actions");
const viewPane = document.querySelector(".js-pane-view");
const pointInfo = document.querySelector(".js-point-info");
const pointMedical = document.querySelector(".js-point-medical");
const pointDescription = document.querySelector(".js-point-description");
const appendButton = document.querySelector(".js-button-append");
const cancelButton = document.querySelector(".js-button-cancel");
const voteButton = document.querySelector(".js-button-vote");
const voteCancelButton = document.querySelector(".js-button-cancel-vote");
const settingsButton = document.querySelector(".js-button-settings");
const settingsPane = document.querySelector(".js-settings-pane");
const applySettingsButton = document.querySelector(".js-button-apply-settings");
const cancelSettingsButton = document.querySelector(
  ".js-button-cancel-settings"
);
const distanceSetting = document.querySelector(".js-settings-distance");
const distanceSettingString = document.querySelector(
  ".js-settings-distance-string"
);

const getRelativeTimeFormatter = (function () {
  let formatter = null;

  return function () {
    if (formatter === null) {
      formatter = new TimeAgo();
    }

    return formatter;
  };
})();

const numberFormatter = new Intl.NumberFormat("ru-RU");

const api = axios.create({
  baseURL: "https://m.deluxspa.ru/api",
});

function fromYMapsEvents(entity, events) {
  return new rxjs.Observable(function (subscriber) {
    function onEvent(event) {
      subscriber.next(event);
    }

    entity.events.add(events, onEvent);

    return function () {
      entity.event.remove(events, onEvent);
    };
  });
}

function request$(method, ...args) {
  return new rxjs.Observable(function (subscriber) {
    let isSubscribed = true;

    api[method](...args)
      .then(function ({ data }) {
        if (isSubscribed) {
          subscriber.next(data);
          subscriber.complete();
        }
      })
      .catch(function (error) {
        if (isSubscribed) {
          subscriber.error(error);
        }
      });

    return () => {
      isSubscribed = false;
    };
  });
}

function get$(...args) {
  return request$("get", ...args);
}

// FIXME CSRF token
function post$(...args) {
  return request$("post", ...args);
}

const ymaps$ = new rxjs.Observable(function (subscriber) {
  let isSubscribed = true;

  ymaps.ready(function () {
    if (isSubscribed) {
      subscriber.next(ymaps);
      subscriber.complete();
    }
  });

  return () => {
    isSubscribed = false;
  };
}).pipe(rxjs.shareReplay(1));

const map$ = ymaps$.pipe(
  rxjs.map(
    (ymaps) =>
      new ymaps.Map("map", {
        center: [55.76, 37.64],
        zoom: 7,
      })
  ),
  rxjs.shareReplay(1)
);

const geolocation$ = rxjs.combineLatest([ymaps$, map$]).pipe(
  rxjs.take(1),
  rxjs.map(([ymaps, map]) =>
    rxjs
      .from(ymaps.geolocation.get())
      .pipe(rxjs.map((response) => [ymaps, map, response]))
  ),
  rxjs.switchAll(),
  rxjs.map(([ymaps, map, response]) => [
    map,
    ymaps.util.bounds.getCenterAndZoom(
      response.geoObjects.get(0).properties.get("boundedBy"),
      [mapContainer.offsetWidth, mapContainer.offsetHeight]
    ),
  ])
);

const mapClicks$ = map$.pipe(
  rxjs.mergeMap((map) => fromYMapsEvents(map, "click")),
  rxjs.share(1)
);

const balloonOpens$ = map$.pipe(
  rxjs.mergeMap((map) => fromYMapsEvents(map.balloon, "open")),
  rxjs.share()
);

const balloonCloses$ = map$.pipe(
  rxjs.mergeMap((map) => fromYMapsEvents(map.balloon, "close")),
  rxjs.share()
);

const balloonClicks$ = map$.pipe(
  rxjs.mergeMap((map) => fromYMapsEvents(map.balloon, "click")),
  rxjs.share()
);

const clusterPointSelected$ = rxjs.merge(balloonOpens$, balloonClicks$).pipe(
  rxjs.map((event) => event.originalEvent.target.balloon.getData().cluster),
  rxjs.filter(Boolean),
  rxjs.map((cluster) => cluster.state.get("activeObject"))
);

const cancelClicks$ = rxjs.fromEvent(cancelButton, "click");
const appendClicks$ = rxjs.fromEvent(appendButton, "click");

const voteClicks$ = rxjs.fromEvent(voteButton, "click");
const voteCancelClicks$ = rxjs.fromEvent(voteCancelButton, "click");

const settingsClicks$ = rxjs.fromEvent(settingsButton, "click");
const settingsApplyClicks$ = rxjs.fromEvent(applySettingsButton, "click");
const settingsCancelClicks$ = rxjs.fromEvent(cancelSettingsButton, "click");

const distanceChanges$ = rxjs.fromEvent(distanceSetting, "input");

const newPointCoords$ = rxjs
  .merge(
    mapClicks$.pipe(rxjs.map((event) => event.get("coords"))),
    balloonCloses$.pipe(rxjs.map(() => null))
  )
  .pipe(rxjs.distinctUntilChanged(), rxjs.shareReplay(1));

const cluster$ = rxjs.combineLatest([ymaps$, map$]).pipe(
  rxjs.map(([ymaps, map]) => {
    return map.geoObjects.getLength() === 0
      ? {
          isAppended: false,
          cluster: new ymaps.Clusterer({
            groupByCoordinates: false,
            clusterDisableClickZoom: true,
            clusterHideIconOnBalloonOpen: false,
            geoObjectHideIconOnBalloonOpen: false,
          }),
        }
      : { isAppended: true, cluster: map.geoObjects.get(0) };
  })
);

const chatId$ = rxjs
  .of(new URL(location.href).searchParams.get("chat_id"))
  .pipe(rxjs.shareReplay(1));

const user$ = ymaps$.pipe(
  rxjs.switchMap(() => chatId$),
  rxjs.switchMap((chatId) =>
    get$("/me", {
      params: {
        chat_id: chatId,
      },
    }).pipe(
      rxjs.map(({ user }) => ({ ...user, isAuthorized: true })),
      rxjs.catchError(() =>
        rxjs.of({ isAuthorized: false, id: 0, first_name: "Гость" })
      )
    )
  ),
  rxjs.shareReplay(1)
);

const settings$ = chatId$.pipe(
  rxjs.switchMap((chatId) =>
    get$("/settings", {
      params: {
        chat_id: chatId,
      },
    }).pipe(
      rxjs.map(({ distance }) => ({ distance })),
      rxjs.catchError(() => rxjs.of({ distance: 300 }))
    )
  ),
  rxjs.shareReplay(1)
);

const settingsUpdated$ = chatId$.pipe(
  rxjs.switchMap((chatId) =>
    settingsApplyClicks$.pipe(rxjs.map(() => [chatId, distanceSetting.value]))
  ),
  rxjs.switchMap(([chatId, distance]) =>
    post$("/settings", { chatId, distance }).pipe(
      rxjs.map(({ distance }) => ({ distance })),
      rxjs.catchError(() => rxjs.of({ distance }))
    )
  ),
  rxjs.share()
);

const socketMessage$ = user$.pipe(
  rxjs.map(() => io()),
  rxjs.map((socket) =>
    rxjs.fromEvent(socket, "connect").pipe(rxjs.map(() => socket))
  ),
  rxjs.switchAll(),
  rxjs.map((socket) => rxjs.fromEvent(socket, "point")),
  rxjs.switchAll()
);

const pointAppended$ = user$.pipe(
  rxjs.map(({ id, first_name, last_name }) =>
    newPointCoords$.pipe(
      rxjs.map((coords) =>
        coords
          ? appendClicks$.pipe(
              rxjs.map(() =>
                coords
                  ? post$("/map/points", {
                      user: { id, first_name, last_name },
                      latitude: coords[0],
                      longitude: coords[1],
                      description: pointDescription.value.trim(),
                      medical: pointMedical.checked,
                    }).pipe(
                      rxjs.map(() => ({ success: true })),
                      rxjs.catchError(() => rxjs.of({ success: false }))
                    )
                  : rxjs.EMPTY
              ),
              rxjs.switchAll()
            )
          : rxjs.EMPTY
      ),
      rxjs.switchAll()
    )
  ),
  rxjs.switchAll(),
  rxjs.share()
);

const pointVoted$ = user$.pipe(
  rxjs.map(({ id, first_name, last_name }) =>
    selectedPoint$.pipe(
      rxjs.map((placemark) =>
        voteClicks$.pipe(
          rxjs.map(() =>
            post$("/map/points/vote", {
              id: placemark.options.get("botPoint").id,
              user: { id, first_name, last_name },
            }).pipe(
              rxjs.map(() => ({ success: true })),
              rxjs.catchError(() => rxjs.of({ success: false }))
            )
          ),
          rxjs.switchAll()
        )
      ),
      rxjs.switchAll()
    )
  ),
  rxjs.switchAll(),
  rxjs.share()
);

const fetchInterval = rxjs.interval(1 * 60 * 1000);

const fetchedPoints$ = rxjs.merge(ymaps$, fetchInterval).pipe(
  rxjs.map(() =>
    get$("/map/points").pipe(rxjs.catchError(() => rxjs.of({ points: [] })))
  ),
  rxjs.switchAll(),
  rxjs.map(({ points }) => ({ action: "list", points })),
  rxjs.shareReplay(1)
);

const points$ = rxjs.merge(fetchedPoints$, socketMessage$).pipe(
  rxjs.scan((points, event) => {
    if (event.action === "list") {
      return event.points;
    }
    if (event.action === "update") {
      return points.map((point) =>
        point.id === event.document.id ? event.document : point
      );
    }
    if (event.action === "insert") {
      if (!points.find((point) => point.id === event.document.id)) {
        return [...points, event.document];
      }
    }
    if (event.action === "delete") {
      return points.filter((point) => point.id !== event.document.id);
    }

    return points;
  }, []),
  rxjs.shareReplay(1)
);

function renderPointBallonBody(point) {
  const parts = [];

  parts.push(
    `<p>Замечен ${getRelativeTimeFormatter().format(point.createdAt)} (${moment(
      point.createdAt
    ).format("HH:mm DD.MM.YYYY")})<br />Добавил ${[
      point.createdBy.first_name,
      point.createdBy.last_name,
    ]
      .filter(Boolean)
      .join(" ")}`
  );

  if (point.medical) {
    parts.push("<p><b>Работает медслужба</b></p>");
  }

  if (point.description) {
    parts.push(`<p><b>Комментарий</b>:<br />${point.description}</p>`);
  }

  if (point.status === "created") {
    parts.push("<p>Подтверждений пока нет</p>");
  } else if (point.status === "voted") {
    parts.push(
      `<p>Подтвержден ${getRelativeTimeFormatter().format(
        point.votedAt
      )} (${moment(point.votedAt).format("HH:mm DD.MM.YYYY")})</p>`
    );
  } else {
    parts.push(
      point.votedAt
        ? `<p>Последнее подтверждение ${getRelativeTimeFormatter().format(
            point.votedAt
          )} (${moment(point.votedAt).format("HH:mm DD.MM.YYYY")})</p>`
        : "<p>Подтверждений нет</p>"
    );
  }

  if (point.votes.length) {
    const text = [...point.votes]
      .reverse()
      .map(
        ({ createdAt, createdBy }) =>
          `${moment(createdAt).format("HH:mm")} подтвердил ${[
            createdBy.first_name,
            createdBy.last_name,
          ]
            .filter(Boolean)
            .join(" ")}`
      )
      .join("<br />");

    parts.push(`<p><b>Подтверждения</b><br />${text}</p>`);
  }

  return parts.join("");
}

const placemarks$ = rxjs.combineLatest([points$, ymaps$]).pipe(
  rxjs.map(([points, ymaps]) =>
    points.map(
      (point) =>
        new ymaps.Placemark(
          [point.latitude, point.longitude],
          {
            balloonContentHeader: `${point.latitude.toPrecision(
              6
            )}, ${point.longitude.toPrecision(6)}`,
            balloonContentBody: renderPointBallonBody(point),
          },
          {
            iconLayout: "default#image",
            iconImageHref: `//m.deluxspa.ru/web_app/images/icons/${point.status}.png`,
            iconImageSize: [48, 48],
            iconImageOffset: [-24, -48],
            botPoint: point,
          }
        )
    )
  ),
  rxjs.shareReplay(1)
);

const selectedPoint$ = placemarks$.pipe(
  rxjs.map((placemarks) => rxjs.from(placemarks)),
  rxjs.mergeAll(),
  rxjs.map((placemark) =>
    fromYMapsEvents(placemark, ["click", "mandala_bot:selected"]).pipe(
      rxjs.map(() => placemark)
    )
  ),
  rxjs.mergeAll()
);

const settingPaneVisible$ = rxjs
  .merge(
    settingsClicks$.pipe(rxjs.map(() => ({ action: "toggle" }))),
    settingsCancelClicks$.pipe(rxjs.map(() => ({ action: "cancel" }))),
    settingsApplyClicks$.pipe(rxjs.map(() => ({ action: "apply" })))
  )
  .pipe(
    rxjs.scan((visible, { action }) => {
      if (action === "toggle") {
        return !visible;
      }
      if (action === "cancel" || action === "apply") {
        return false;
      }

      return visible;
    }, false),
    rxjs.startWith(false),
    rxjs.shareReplay(1)
  );

const alerts$ = rxjs
  .merge(
    pointAppended$.pipe(
      rxjs.map(() => "Точка успешно создана"),
      rxjs.catchError(() => rxjs.of("Не удалось создать точку"))
    ),
    pointVoted$.pipe(
      rxjs.map(({ success }) =>
        success ? "Подтверждение получено" : "Не удалось подтвердить"
      )
    )
  )
  .pipe(rxjs.share());

settingPaneVisible$.subscribe((visible) =>
  visible
    ? settingsPane.classList.add("visible")
    : settingsPane.classList.remove("visible")
);

rxjs
  .merge(
    settings$.pipe(rxjs.map(({ distance }) => distance)),
    settingsUpdated$.pipe(rxjs.map(({ distance }) => distance)),
    distanceChanges$.pipe(rxjs.map(() => distanceSetting.value))
  )
  .subscribe((distance) => {
    distanceSetting.value = distance;
    distanceSettingString.innerHTML = `${numberFormatter.format(distance)} м.`;
  });

user$.subscribe(function ({ isAuthorized, first_name, last_name }) {
  userInfo.innerHTML = isAuthorized
    ? [first_name, last_name].filter(Boolean).join(" ")
    : "Гость";
});

newPointCoords$.subscribe(function (coords) {
  if (coords) {
    pointInfo.innerHTML = coords
      .map((coord) => coord.toPrecision(6))
      .join(", ");
    actionsPane.classList.add("visible");
  } else {
    actionsPane.classList.remove("visible");
  }
});

map$
  .pipe(
    rxjs.map((map) =>
      rxjs
        .merge(cancelClicks$, voteCancelClicks$, pointAppended$, pointVoted$)
        .pipe(rxjs.map(() => map))
    ),
    rxjs.switchAll()
  )
  .subscribe(function (map) {
    map.balloon.close();
  });

rxjs
  .combineLatest([map$, newPointCoords$.pipe(rxjs.filter(Boolean))])
  .subscribe(function ([map, coords]) {
    map.balloon.open(coords, {
      contentHeader: "Новая точка",
      contentBody: `<p>Координаты точки: ${coords[0].toPrecision(
        5
      )}:${coords[1].toPrecision(6)}.`,
    });
  });

map$
  .pipe(
    rxjs.map((map) =>
      placemarks$.pipe(
        rxjs.map((placemarks) =>
          cluster$.pipe(
            rxjs.map((clusterData) => ({ map, placemarks, clusterData }))
          )
        ),
        rxjs.switchAll()
      )
    ),
    rxjs.switchAll()
  )
  .subscribe(function ({
    map,
    placemarks,
    clusterData: { isAppended, cluster },
  }) {
    if (isAppended) {
      cluster.removeAll();
      cluster.add(placemarks);
    } else {
      cluster.add(placemarks);
      map.geoObjects.add(cluster);
    }
  });

pointAppended$.subscribe(function () {
  pointDescription.value = "";
});

clusterPointSelected$.subscribe((object) => {
  object.events.fire("mandala_bot:selected");
});

rxjs
  .merge(selectedPoint$, balloonCloses$.pipe(rxjs.map(() => null)))
  .subscribe((selectedPoint) => {
    if (selectedPoint) {
      viewPane.classList.add("visible");
    } else {
      viewPane.classList.remove("visible");
    }
  });

geolocation$.subscribe(([map, { center, zoom }]) => {
  map.setZoom(zoom);
  map.setCenter(center);
});

alerts$.subscribe((alert) => {
  try {
    Telegram.WebApp.showAlert(alert);
  } catch (error) {
    console.log("Unable to show telegram alert dialog");
  }
});
